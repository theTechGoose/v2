import { Inject, Injectable } from "#danet/core";
import {
  LLM_CLIENT,
  type LLMClient,
} from "@agents/domain/business/llm/base/mod.ts";
import { t } from "@core/i18n/mod.ts";
import { extractPriceCents } from "#quote-flow/quick-quote-prefill.ts";
import { deriveBasis, type PriceBasis } from "@agents/domain/business/price-basis/mod.ts";

export interface SuggestPricesInput {
  userId: string;
  /** Raw job description the contractor typed — their ORIGINAL message,
   *  with every quantity, material and cost they named (REQ-260 / M24). */
  raw: string;
  /** REQ-260 (M24): the scope bullets the contractor confirmed in the "help
   *  me price it" picker. Sent beside `raw`, never instead of it — the
   *  bullets are 3–4 short lines with prices dropped, and pricing on them
   *  alone priced a full bathroom gut as "a typical small job". */
  scope?: string;
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
   *  shown on the tier cards. REQ-332 (m30): derived from the job, never a
   *  constant — "labor_materials_as_noted" when the customer supplies items. */
  basis: PriceBasis;
}

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

    const scope = input.scope?.trim() ?? "";
    const job = scope && scope !== raw
      ? `Contractor's original message:\n${raw}\n\nConfirmed scope (the bullets the contractor agreed to):\n${scope}`
      : `Raw job description:\n${raw}`;
    // REQ-332 (m30): the basis is read off the job. When the customer
    // supplies an item, the model is told so in as many words.
    const basis = deriveBasis(raw, scope);
    const basisLine = basis === "labor_materials_as_noted"
      ? "\n\nThe customer supplies some of the materials (see the message): price the labor and only the materials the contractor provides."
      : "";
    const content = `${job}${locationLine}${basisLine}${langLine}`;

    // REQ-260 (M24): the largest dollar amount the contractor stated (a
    // subcontractor's quote, the materials) is a floor no tier may sit under.
    const floorCents = extractPriceCents(raw) ?? 0;

    const ask = async (messages: { role: "user" | "assistant"; content: string }[]) => {
      const res = await this.llm.respond({
        systemPrompt: SYSTEM_PROMPT,
        messages,
        userId: input.userId,
        model: PRICING_MODEL,
        // REQ-260: JSON mode — no chat tools ride along on this one-shot call.
        responseFormat: "json",
      });
      return { text: res.text ?? "", options: normalize(tryParseJson(res.text ?? "")?.options, lang) };
    };

    let options: PriceOption[];
    try {
      const first = await ask([{ role: "user", content }]);
      options = first.options;
      if (options.length === 3 && floorCents > 0 && options[0].priceCents <= floorCents) {
        // Re-ask once, naming the cost the tiers fell under.
        const again = await ask([
          { role: "user", content },
          { role: "assistant", content: first.text },
          {
            role: "user",
            content: `Every one of those prices is at or below ${dollars(floorCents)}, a cost the contractor stated ` +
              `in their message. Stated costs are a FLOOR: each tier must cover them plus the rest of the labor, ` +
              `materials and markup for the full scope. Return the corrected JSON.`,
          },
        ]).catch(() => undefined);
        if (again && again.options.length === 3) options = again.options;
      }
    } catch (err) {
      console.error("[suggest-prices] llm call failed:", err);
      options = [];
    }
    if (options.length !== 3) options = fallbackTiers(lang);
    return { options: liftAboveFloor(options, floorCents), basis };
  }
}

/** "$2,800" from 280000. */
function dollars(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

/**
 * REQ-260 (M24): last line of defence — if the tiers (the model's after one
 * re-ask, or the generic fallback) still sit at or under a cost the
 * contractor stated, scale them up so the competitive tier clears it by a
 * markup, keeping their spread and order. Rounded to whole $50.
 */
function liftAboveFloor(options: PriceOption[], floorCents: number): PriceOption[] {
  if (floorCents <= 0 || options[0].priceCents > floorCents) return options;
  const factor = (floorCents * 1.2) / options[0].priceCents;
  const step = 5000;
  let prev = 0;
  return options.map((o) => {
    let cents = Math.ceil((o.priceCents * factor) / step) * step;
    if (cents <= prev) cents = prev + step;
    prev = cents;
    return { ...o, priceCents: cents };
  });
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
