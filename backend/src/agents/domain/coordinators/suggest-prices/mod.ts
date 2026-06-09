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
}

export interface PriceOption {
  /** Stable tier id. */
  tier: "basic" | "standard" | "premium";
  /** Short customer-facing label ("Standard"). */
  label: string;
  /** Suggested price in INTEGER CENTS. */
  priceCents: number;
  /** One-line justification ("Covers materials + 1 day labor"). */
  rationale: string;
}

export interface SuggestPricesResult {
  options: PriceOption[];
}

const SYSTEM_PROMPT = t("en", "prompts.suggestPrices");

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

    let text: string;
    try {
      const res = await this.llm.respond({
        systemPrompt: SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: `Raw job description:\n${raw}${langLine}`,
        }],
        userId: input.userId,
      });
      text = res.text ?? "";
    } catch (err) {
      console.error("[suggest-prices] llm call failed:", err);
      return { options: fallbackTiers(lang) };
    }

    const parsed = tryParseJson(text);
    const options = normalize(parsed?.options, lang);
    return { options: options.length === 3 ? options : fallbackTiers(lang) };
  }
}

function normalize(raw: unknown, lang: "en" | "es"): PriceOption[] {
  if (!Array.isArray(raw)) return [];
  const tiers: PriceOption["tier"][] = ["basic", "standard", "premium"];
  const labels = [
    t(lang, "suggestPrices.tier.basic"),
    t(lang, "suggestPrices.tier.standard"),
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
      label: typeof o?.label === "string" && o.label.trim()
        ? o.label.trim()
        : labels[out.length],
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
      tier: "basic",
      label: t(lang, "suggestPrices.tier.basic"),
      priceCents: 50000,
      rationale: t(lang, "suggestPrices.fallback.basicRationale"),
    },
    {
      tier: "standard",
      label: t(lang, "suggestPrices.tier.standard"),
      priceCents: 85000,
      rationale: t(lang, "suggestPrices.fallback.standardRationale"),
    },
    {
      tier: "premium",
      label: t(lang, "suggestPrices.tier.premium"),
      priceCents: 120000,
      rationale: t(lang, "suggestPrices.fallback.premiumRationale"),
    },
  ];
}
