import { Inject, Injectable } from "#danet/core";
import {
  LLM_CLIENT,
  type LLMClient,
} from "@agents/domain/business/llm/base/mod.ts";

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

const SYSTEM_PROMPT =
  `You are a pricing assistant for a contractor. Given a raw job description,
propose THREE price options the contractor can choose between.

OUTPUT — JSON only, no prose, no code fences:
  { "options": [
    { "tier": "basic",    "label": "Basic",    "priceCents": <int>, "rationale": "<≤10 words>" },
    { "tier": "standard", "label": "Standard", "priceCents": <int>, "rationale": "<≤10 words>" },
    { "tier": "premium",  "label": "Premium",  "priceCents": <int>, "rationale": "<≤10 words>" }
  ] }

RULES:
- Exactly 3 options, ascending price: basic < standard < premium.
- priceCents is an integer number of cents (e.g. $850.00 → 85000).
- Base the numbers on typical US small-contractor pricing for the described
  work. If the description is vague, give a reasonable mid-market range.
- rationale is ≤10 words, plain, no hype, no emojis.
- Return JSON only.`;

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

    const langLine = input.lang === "es"
      ? "\n\nWrite each label and rationale in neutral Latin-American Spanish."
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
      return { options: fallbackTiers() };
    }

    const parsed = tryParseJson(text);
    const options = normalize(parsed?.options);
    return { options: options.length === 3 ? options : fallbackTiers() };
  }
}

function normalize(raw: unknown): PriceOption[] {
  if (!Array.isArray(raw)) return [];
  const tiers: PriceOption["tier"][] = ["basic", "standard", "premium"];
  const labels = ["Basic", "Standard", "Premium"];
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
function fallbackTiers(): PriceOption[] {
  return [
    {
      tier: "basic",
      label: "Basic",
      priceCents: 50000,
      rationale: "Core scope, essentials only",
    },
    {
      tier: "standard",
      label: "Standard",
      priceCents: 85000,
      rationale: "Full scope, typical materials",
    },
    {
      tier: "premium",
      label: "Premium",
      priceCents: 120000,
      rationale: "Premium materials, extra finish",
    },
  ];
}
