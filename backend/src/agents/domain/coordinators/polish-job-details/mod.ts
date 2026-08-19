import { Inject, Injectable } from "#danet/core";
import {
  LLM_CLIENT,
  type LLMClient,
} from "@agents/domain/business/llm/base/mod.ts";
import { t } from "@core/i18n/mod.ts";
import { summarizeJobName } from "#quote-flow/job-name.ts";
import { clampSummary } from "#quote-flow/summary-clamp.ts";

export interface PolishJobDetailsInput {
  userId: string;
  /** Raw text the contractor typed into the chat box. */
  raw: string;
  /** Optional price (cents) — gives the LLM scope context so the
   *  polished paragraph doesn't promise more than the price covers. */
  priceCents?: number;
  /** Outgoing-comms language (roadmap p.13) — the polished copy is
   *  customer-facing, so write it in the customer's language. */
  commsLanguage?: string;
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

const SYSTEM_PROMPT = t("en", "prompts.polishJobDetails.system");

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

    const lang: "en" | "es" = input.commsLanguage === "es" ? "es" : "en";

    const priceLine =
      typeof input.priceCents === "number" && input.priceCents > 0
        ? "\n\n" + t("en", "prompts.polishJobDetails.priceLine", {
          amount: `$${
            (input.priceCents / 100).toLocaleString("en-US", {
              minimumFractionDigits: 0,
              maximumFractionDigits: 2,
            })
          }`,
        })
        : "";

    const langLine = input.commsLanguage === "es"
      ? "\n\n" + t("en", "prompts.polishJobDetails.spanishInstruction")
      : "";

    let text: string;
    try {
      const res = await this.llm.respond({
        systemPrompt: SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: `${
            t("en", "prompts.polishJobDetails.rawLabel")
          }\n${raw}${priceLine}${langLine}`,
        }],
        userId: input.userId,
      });
      text = res.text ?? "";
    } catch (err) {
      console.error("[polish-job-details] llm call failed:", err);
      return fallback(raw, lang);
    }

    const parsed = tryParseJson(text);
    if (
      parsed && typeof parsed.summary === "string" &&
      typeof parsed.description === "string"
    ) {
      const summary = clampSummary(parsed.summary);
      const jobName =
        typeof parsed.jobName === "string" && parsed.jobName.trim()
          ? clampJobName(parsed.jobName, lang)
          : deriveJobName(summary, lang);
      return {
        summary,
        jobName,
        description: parsed.description.trim(),
      };
    }
    return fallback(raw, lang);
  }
}

function tryParseJson(
  s: string,
): { summary?: unknown; jobName?: unknown; description?: unknown } | undefined {
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

// UX-18: summaries are clamped by the ONE shared helper (visible "…" on
// truncation, never a silent mid-phrase cut) — imported above.

/** UX-05/UX-41: Spanish names are sentence case with lowercase connectors,
 *  never blanket Title Case — the shared lang-aware derivation owns that. */
function clampJobName(s: string, lang: "en" | "es"): string {
  if (lang === "es") return summarizeJobName(s, "es");
  const cleaned = s.trim().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(
    /\s+/g,
    " ",
  );
  const words = cleaned.split(" ").filter(Boolean).slice(0, 3);
  return words.map(titleCaseWord).join(" ");
}

function deriveJobName(summary: string, lang: "en" | "es"): string {
  return clampJobName(summary, lang);
}

function titleCaseWord(w: string): string {
  if (!w) return w;
  return w[0].toUpperCase() + w.slice(1).toLowerCase();
}

function fallback(raw: string, lang: "en" | "es"): PolishJobDetailsResult {
  const firstLine = raw.split(/\n/)[0].trim();
  const summaryWords = clampSummary(firstLine);
  const summary = summaryWords || t(lang, "polishJobDetails.fallbackSummary");
  return {
    summary,
    jobName: deriveJobName(summary, lang),
    description: raw,
  };
}
