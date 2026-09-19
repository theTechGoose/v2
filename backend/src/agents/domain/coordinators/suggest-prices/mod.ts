import { Inject, Injectable } from "#danet/core";
import {
  LLM_CLIENT,
  type LLMClient,
} from "@agents/domain/business/llm/base/mod.ts";
import { t } from "@core/i18n/mod.ts";

export interface SuggestPricesInput {
  userId: string;
  /** Raw job description the contractor typed. */
  raw: string;
  /** Contractor UI language (roadmap p.13) — these tiers are shown to the
   *  contractor while pricing, so label/rationale follow their language. */
  lang?: string;
  /** REQ-017 (NW-09): the contractor's saved business location — the model
   *  prices for THIS market, never a national average. */
  address?: { city?: string; state?: string; postal?: string };
}

export interface PriceOption {
  /** Stable tier id — the client's three tiers (REQ-017 / NW-08). */
  tier: "competitive" | "market" | "premium";
  /** Fixed, localized label ("Market"). Never the model's own wording. */
  label: string;
  /** Suggested price in INTEGER CENTS. */
  priceCents: number;
  /** One-line justification ("Covers materials + 1 day labor"). */
  rationale: string;
}

export interface SuggestPricesResult {
  options: PriceOption[];
  /** REQ-017 (NW-12): what the numbers include — stated to the model and
   *  shown on the tier cards. */
  basis: "labor_and_materials";
}

const BASIS = "labor_and_materials" as const;

const SYSTEM_PROMPT = t("en", "prompts.suggestPrices");

/** REQ-017 (NW-12): gpt-4o-mini priced the client's 2,000 sq ft repaint at
 *  $3k–$6k against a $6.5k–$16k Claude/ChatGPT comparison; this one call asks
 *  for a stronger model. Override with SUGGEST_PRICES_MODEL. */
const PRICING_MODEL = Deno.env.get("SUGGEST_PRICES_MODEL")?.trim() || "gpt-4o";

/**
 * SuggestPrices — one-shot LLM pass behind the "I know the job, help me
 * price it" flow (roadmap p.10). Turns the job description into three
 * price tiers the contractor picks from (with a 4th "custom" entry handled
 * client-side). Falls back to generic tiers when the LLM is unavailable
 * (dev/stub) so the flow always renders something pickable.
 */
@Injectable()
export class SuggestPrices {
  constructor(@Inject(LLM_CLIENT) private llm: LLMClient) {}

  async run(input: SuggestPricesInput): Promise<SuggestPricesResult> {
    const raw = input.raw.trim();
    if (!raw) throw new Error("raw is required");

    const lang: "en" | "es" = input.lang === "es" ? "es" : "en";
    const langLine = input.lang === "es"
      ? t("en", "prompts.suggestPricesSpanishDirective")
      : "";

    // REQ-017 (NW-09): price for the contractor's market. The line is
    // omitted entirely when no address is saved.
    const a = input.address ?? {};
    const cityState = [a.city?.trim(), a.state?.trim()].filter(Boolean).join(", ");
    const location = `${cityState} ${a.postal?.trim() ?? ""}`.trim();
    const locationLine = location ? `\n\nContractor location: ${location}` : "";

    let text: string;
    try {
      const res = await this.llm.respond({
        systemPrompt: SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: `Raw job description:\n${raw}${locationLine}${langLine}`,
        }],
        userId: input.userId,
        model: PRICING_MODEL,
      });
      text = res.text ?? "";
    } catch (err) {
      console.error("[suggest-prices] llm call failed:", err);
      return { options: fallbackTiers(lang), basis: BASIS };
    }

    const parsed = tryParseJson(text);
    const options = normalize(parsed?.options, lang);
    return {
      options: options.length === 3 ? options : fallbackTiers(lang),
      basis: BASIS,
    };
  }
}

function normalize(raw: unknown, lang: "en" | "es"): PriceOption[] {
  if (!Array.isArray(raw)) return [];
  const tiers: PriceOption["tier"][] = ["competitive", "market", "premium"];
  const labels = [
    t(lang, "suggestPrices.tier.competitive"),
    t(lang, "suggestPrices.tier.market"),
    t(lang, "suggestPrices.tier.premium"),
  ];
  const out: PriceOption[] = [];
  for (let i = 0; i < raw.length && out.length < 3; i++) {
    const o = raw[i] as {
      tier?: unknown;
      label?: unknown;
      priceCents?: unknown;
      rationale?: unknown;
    };
    const cents = Math.round(Number(o?.priceCents));
    if (!Number.isFinite(cents) || cents <= 0) continue;
    out.push({
      tier: tiers[out.length],
      // REQ-017: the fixed label IS the product ("Basic" from the model was
      // the p7 complaint); the model contributes numbers + rationale only.
      label: labels[out.length],
      priceCents: cents,
      rationale: typeof o?.rationale === "string" ? o.rationale.trim() : "",
    });
  }
  // Keep them ascending so the cards read low → high.
  out.sort((a, b) => a.priceCents - b.priceCents);
  return out;
}

function tryParseJson(s: string): { options?: unknown } | undefined {
  if (!s) return undefined;
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : s).trim();
  try {
    return JSON.parse(candidate);
  } catch { /* fall through */ }
  const braceStart = candidate.indexOf("{");
  const braceEnd = candidate.lastIndexOf("}");
  if (braceStart >= 0 && braceEnd > braceStart) {
    try {
      return JSON.parse(candidate.slice(braceStart, braceEnd + 1));
    } catch { /* swallow */ }
  }
  return undefined;
}

/** Generic mid-market tiers for dev/stub or when the model returns garbage. */
function fallbackTiers(lang: "en" | "es"): PriceOption[] {
  return [
    {
      tier: "competitive",
      label: t(lang, "suggestPrices.tier.competitive"),
      priceCents: 50000,
      rationale: t(lang, "suggestPrices.fallback.competitiveRationale"),
    },
    {
      tier: "market",
      label: t(lang, "suggestPrices.tier.market"),
      priceCents: 85000,
      rationale: t(lang, "suggestPrices.fallback.marketRationale"),
    },
    {
      tier: "premium",
      label: t(lang, "suggestPrices.tier.premium"),
      priceCents: 120000,
      rationale: t(lang, "suggestPrices.fallback.premiumRationale"),
    },
  ];
}
