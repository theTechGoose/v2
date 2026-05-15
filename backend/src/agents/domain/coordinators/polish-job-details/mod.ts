import { Inject, Injectable } from "#danet/core";
import { LLM_CLIENT, type LLMClient } from "@agents/domain/business/llm/base/mod.ts";

export interface PolishJobDetailsInput {
  userId: string;
  /** Raw text the contractor typed into the chat box. */
  raw: string;
  /** Optional price (cents) — gives the LLM scope context so the
   *  polished paragraph doesn't promise more than the price covers. */
  priceCents?: number;
}

export interface PolishJobDetailsResult {
  /** Short title (≤8 words) used in headings, email subjects, etc. */
  summary: string;
  /** Ultra-short label, three words or less, Title Case, used as the
   *  primary human-facing job identifier across the platform: in-chat
   *  card title, contract hero, email subject, SMS body. Falls back
   *  to `summary` downstream when this is missing. */
  jobName: string;
  /** Polished 1–3 sentence paragraph rendered on the quote, quote email,
   *  and the contract page's job-details section. */
  description: string;
}

const SYSTEM_PROMPT = `You polish a contractor's raw job description into clean, professional copy a customer will read on a quote.

OUTPUT — return JSON only, no prose, no code fences:
  { "jobName": "<3 words or less, Title Case>", "summary": "<short title, max 8 words, title case>", "description": "<1-3 sentences, professional, third-person>" }

RULES:
- jobName is a noun-phrase label like "Backyard Junk Removal" or "Kitchen Remodel" — three words or fewer, Title Case, no punctuation.
- Use only facts the contractor stated. Do NOT invent materials, scope, square footage, brands, durations, or warranties.
- No filler hype ("we'll do an amazing job"). Keep it concrete and calm.
- No first-person ("I'll …"). Write as the contractor describing what the job covers.
- No emojis, no exclamation marks, no marketing language.
- Fix obvious typos and grammar. Expand shorthand (e.g. "BR" → "bathroom") only when the meaning is unambiguous.
- If the raw text is too vague to polish meaningfully, mirror it back cleaned-up rather than padding with assumptions.
`;

/**
 * PolishJobDetails — one-shot LLM pass that turns a contractor's
 * raw chat-box input into a clean summary + polished paragraph.
 *
 * Used by the "tell me the job details" step after price capture.
 * The result is saved on the quote as `summary` + `description` and
 * surfaces on the quote preview, the quote email, and the contract.
 */
@Injectable()
export class PolishJobDetails {
  constructor(@Inject(LLM_CLIENT) private llm: LLMClient) {}

  async run(input: PolishJobDetailsInput): Promise<PolishJobDetailsResult> {
    const raw = input.raw.trim();
    if (!raw) throw new Error("raw is required");

    const priceLine = typeof input.priceCents === "number" && input.priceCents > 0
      ? `\n\nQuoted price for this job: $${(input.priceCents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}. Scope your description to fit that range.`
      : "";

    let text: string;
    try {
      const res = await this.llm.respond({
        systemPrompt: SYSTEM_PROMPT,
        messages: [{ role: "user", content: `Raw job description:\n${raw}${priceLine}` }],
        userId: input.userId,
      });
      text = res.text ?? "";
    } catch (err) {
      console.error("[polish-job-details] llm call failed:", err);
      return fallback(raw);
    }

    const parsed = tryParseJson(text);
    if (parsed && typeof parsed.summary === "string" && typeof parsed.description === "string") {
      const summary = clampSummary(parsed.summary);
      const jobName = typeof parsed.jobName === "string" && parsed.jobName.trim()
        ? clampJobName(parsed.jobName)
        : deriveJobName(summary);
      return {
        summary,
        jobName,
        description: parsed.description.trim(),
      };
    }
    return fallback(raw);
  }
}

function tryParseJson(s: string): { summary?: unknown; jobName?: unknown; description?: unknown } | undefined {
  if (!s) return undefined;
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : s).trim();
  try { return JSON.parse(candidate); } catch { /* fall through */ }
  const braceStart = candidate.indexOf("{");
  const braceEnd = candidate.lastIndexOf("}");
  if (braceStart >= 0 && braceEnd > braceStart) {
    try { return JSON.parse(candidate.slice(braceStart, braceEnd + 1)); } catch { /* swallow */ }
  }
  return undefined;
}

function clampSummary(s: string): string {
  const cleaned = s.trim().replace(/\s+/g, " ");
  const words = cleaned.split(" ");
  return words.length <= 8 ? cleaned : words.slice(0, 8).join(" ");
}

function clampJobName(s: string): string {
  const cleaned = s.trim().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s+/g, " ");
  const words = cleaned.split(" ").filter(Boolean).slice(0, 3);
  return words.map(titleCaseWord).join(" ");
}

function deriveJobName(summary: string): string {
  return clampJobName(summary);
}

function titleCaseWord(w: string): string {
  if (!w) return w;
  return w[0].toUpperCase() + w.slice(1).toLowerCase();
}

function fallback(raw: string): PolishJobDetailsResult {
  const firstLine = raw.split(/\n/)[0].trim();
  const summaryWords = firstLine.split(/\s+/).slice(0, 8).join(" ");
  const summary = summaryWords || "New job";
  return {
    summary,
    jobName: deriveJobName(summary),
    description: raw,
  };
}
