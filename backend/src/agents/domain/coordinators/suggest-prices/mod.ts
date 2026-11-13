import { Inject, Injectable } from "#danet/core";
import {
  LLM_CLIENT,
  type LLMClient,
} from "@agents/domain/business/llm/base/mod.ts";
import { t } from "@core/i18n/mod.ts";
import { extractPriceCents } from "#quote-flow/quick-quote-prefill.ts";
import {
  customerSuppliedItems,
  deriveBasis,
  isLaborOnly,
  type PriceBasis,
} from "@agents/domain/business/price-basis/mod.ts";
import { describeJobSize, plausibilityFloorCents } from "@agents/domain/business/price-floor/mod.ts";

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
  /** REQ-388 (demo-loop cycle 2, m38): prices this conversation already
   *  gave ("piso radiante en un baño de 8x10: Competitivo $1,500 · …"), so
   *  "y para un baño de 5x8?" is priced consistently with them. Suggestions,
   *  not the contractor's costs — never part of the REQ-260 floor. */
  context?: string;
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
      ? `Contractor's original message:\n${raw}\n\nConfirmed scope (a short summary of that message — it never makes the job smaller; price everything the original message describes):\n${scope}`
      : `Raw job description:\n${raw}`;
    // REQ-332 (m30): the basis is read off the job. REQ-382 (M22): the line
    // names WHAT the customer supplies and has everything else priced — "price
    // the labor and only the materials the contractor provides" priced a
    // master-bath gut whose client supplied the faucets at $1,850.
    const basis = deriveBasis(raw, scope);
    const basisLine = basis === "labor_materials_as_noted"
      ? basisInstruction(raw, scope)
      : "";
    // REQ-388 (m38): earlier prices in the chat — for consistency only.
    const context = input.context?.trim() ?? "";
    const contextLine = context
      ? `\n\nPrices already suggested earlier in this conversation (keep the new prices consistent with them — the same rate per unit; they are suggestions, not the contractor's costs):\n${context}`
      : "";
    const content =
      `${job}${contextLine}${locationLine}${basisLine}${langLine}`;

    // REQ-260 (M24): the largest dollar amount the contractor stated (a
    // subcontractor's quote, the materials) is a floor no tier may sit under.
    const floorCents = extractPriceCents(raw) ?? 0;
    // REQ-382 (M22): the lowest believable price for the job's size and
    // trade (a gut / remodel with N items) — a dropped zero or a labor-only
    // misread lands under it.
    const plausibleCents = plausibilityFloorCents(raw, scope);
    const tooLow = (o: PriceOption[]) =>
      (floorCents > 0 && o[0].priceCents <= floorCents) || o[0].priceCents < plausibleCents;

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
      if (options.length === 3 && tooLow(options)) {
        // Re-ask once, naming the cost or the job size the tiers fell under.
        const reasons: string[] = [];
        if (floorCents > 0 && options[0].priceCents <= floorCents) {
          reasons.push(
            `Every one of those prices is at or below ${dollars(floorCents)}, a cost the contractor stated ` +
              `in their message. Stated costs are a FLOOR: each tier must cover them plus the rest of the labor, ` +
              `materials and markup for the full scope.`,
          );
        }
        if (options[0].priceCents < plausibleCents) {
          reasons.push(
            `${dollars(options[0].priceCents)} is under ${dollars(plausibleCents)}, below what ` +
              `${describeJobSize(raw, scope)} costs anywhere. Price every item in the original message — labor and ` +
              `materials — leaving out only items the customer supplies, and give each price in whole US dollars, not cents.`,
          );
        }
        const again = await ask([
          { role: "user", content },
          { role: "assistant", content: first.text },
          { role: "user", content: `${reasons.join(" ")} Return the corrected JSON.` },
        ]).catch(() => undefined);
        if (again && again.options.length === 3) options = again.options;
      }
    } catch (err) {
      console.error("[suggest-prices] llm call failed:", err);
      options = [];
    }
    if (options.length !== 3) options = fallbackTiers(lang);
    return { options: liftAboveFloor(options, floorCents, plausibleCents), basis };
  }
}

/** REQ-382 (M22): the basis line names the customer's items, so only they
 *  are left out of the price. */
function basisInstruction(raw: string, scope: string): string {
  if (isLaborOnly(raw, scope)) {
    return "\n\nThe contractor says this job is labor only (materials not included): price the labor for the full scope.";
  }
  const items = customerSuppliedItems(raw, scope);
  const named = items.length ? items.map((i) => `"${i}"`).join("; ") : "the items the message says the customer provides";
  return `\n\nThe customer supplies only these items: ${named}. Exclude just those from the price; ` +
    `price everything else, labor and materials, in full.`;
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
 * REQ-382 (M22): the same for the job's plausibility floor — the competitive
 * tier is lifted to at least that floor.
 */
function liftAboveFloor(options: PriceOption[], floorCents: number, plausibleCents = 0): PriceOption[] {
  const underStated = floorCents > 0 && options[0].priceCents <= floorCents;
  const underPlausible = options[0].priceCents < plausibleCents;
  if (!underStated && !underPlausible) return options;
  const target = Math.max(underStated ? floorCents * 1.2 : 0, plausibleCents);
  const factor = target / options[0].priceCents;
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
      price?: unknown;
      priceCents?: unknown;
      rationale?: unknown;
    };
    // REQ-382 (M22): the model returns whole dollars and the code converts —
    // a model-written cents integer is where a zero gets dropped. A legacy
    // priceCents answer is still read as cents.
    const cents = o?.price !== undefined && o?.price !== null
      ? Math.round(Number(o.price) * 100)
      : Math.round(Number(o?.priceCents));
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
