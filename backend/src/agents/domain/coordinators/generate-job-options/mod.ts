import { Inject, Injectable } from "#danet/core";
import {
  LLM_CLIENT,
  type LLMClient,
} from "@agents/domain/business/llm/base/mod.ts";

export interface GenerateJobOptionsInput {
  userId: string;
  /** Raw text the contractor typed into the chat box. */
  raw: string;
  /** Optional price (cents) — scope context so options don't promise
   *  more than the price covers. */
  priceCents?: number;
  /** Outgoing-comms language (roadmap p.13). The options become the
   *  customer-facing quote, so generate them in the customer's language. */
  commsLanguage?: string;
}

export interface JobOption {
  /** Stable id ("opt1" | "opt2" | "opt3") used by the picker. */
  id: string;
  /** ≤3-word Title Case label for the option. */
  jobName: string;
  /** ≤8-word title used as the quote summary if this option is picked. */
  summary: string;
  /** 3–4 scope-of-work bullets, third-person, professional. */
  bullets: string[];
}

export interface GenerateJobOptionsResult {
  options: JobOption[];
}

const SYSTEM_PROMPT =
  `You turn a contractor's raw job description into THREE distinct, customer-ready scope-of-work options.

OUTPUT — return JSON only, no prose, no code fences:
  { "options": [
    { "jobName": "<3 words or less, Title Case>", "summary": "<short title, max 8 words, title case>", "bullets": ["<scope line>", "<scope line>", "<scope line>"] },
    { ... },
    { ... }
  ] }

RULES:
- Return exactly 3 options. Each option has 3 or 4 bullets — no more, no fewer.
- The three options are different phrasings / groupings of the SAME job, ranging from concise to detailed. They are alternatives the contractor picks between, not three separate jobs.
- Each bullet is one short scope-of-work line (≈3–7 words): "Interior demolition", "Haul away debris", "Jobsite cleanup". No sentences, no trailing periods.
- jobName is a noun-phrase label like "Kitchen Remodel" or "Junk Removal" — three words or fewer, Title Case, no punctuation.
- Use only facts the contractor stated. Do NOT invent materials, scope, square footage, brands, durations, or warranties.
- No first-person ("I'll", "we'll"). Write as the contractor describing what the job covers.
- No emojis, no exclamation marks, no marketing hype.
- Fix obvious typos and expand unambiguous shorthand (e.g. "BR" → "bathroom").
- If the raw text is vague, keep the bullets general rather than padding with assumptions.
`;

/**
 * GenerateJobOptions — one-shot LLM pass that turns the contractor's raw
 * chat-box input into three editable scope-of-work options. Used by the
 * assistant's "Job Details" polishing screen (after price capture, before
 * the quote is created): the user edits bullets and picks one option,
 * whose surviving bullets become the quote description.
 */
@Injectable()
export class GenerateJobOptions {
  constructor(@Inject(LLM_CLIENT) private llm: LLMClient) {}

  async run(input: GenerateJobOptionsInput): Promise<GenerateJobOptionsResult> {
    const raw = input.raw.trim();
    if (!raw) throw new Error("raw is required");

    const priceLine =
      typeof input.priceCents === "number" && input.priceCents > 0
        ? `\n\nQuoted price for this job: $${
          (input.priceCents / 100).toLocaleString("en-US", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
          })
        }. Keep each option's scope within that range.`
        : "";

    // Roadmap p.13: the options become the customer-facing quote, so emit
    // them in the contractor's outgoing-comms language.
    const langLine = input.commsLanguage === "es"
      ? "\n\nWrite jobName, summary, and every bullet in neutral Latin-American Spanish."
      : "";

    let text: string;
    try {
      const res = await this.llm.respond({
        systemPrompt: SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: `Raw job description:\n${raw}${priceLine}${langLine}`,
        }],
        userId: input.userId,
      });
      text = res.text ?? "";
    } catch (err) {
      console.error("[generate-job-options] llm call failed:", err);
      return { options: fallbackOptions(raw) };
    }

    const parsed = tryParseJson(text);
    const options = normalizeOptions(parsed?.options);
    if (options.length > 0) return { options };
    return { options: fallbackOptions(raw) };
  }
}

function normalizeOptions(raw: unknown): JobOption[] {
  if (!Array.isArray(raw)) return [];
  const out: JobOption[] = [];
  for (let i = 0; i < raw.length && out.length < 3; i++) {
    const o = raw[i] as {
      jobName?: unknown;
      summary?: unknown;
      bullets?: unknown;
    };
    const bullets = Array.isArray(o?.bullets)
      ? o.bullets
        .filter((b): b is string =>
          typeof b === "string" && b.trim().length > 0
        )
        .map((b) => b.trim().replace(/\s+/g, " ").replace(/[.;]+$/, ""))
        .slice(0, 4)
      : [];
    if (bullets.length === 0) continue;
    const summary = typeof o?.summary === "string" && o.summary.trim()
      ? clampSummary(o.summary)
      : clampSummary(bullets[0]);
    const jobName = typeof o?.jobName === "string" && o.jobName.trim()
      ? clampJobName(o.jobName)
      : deriveJobName(summary);
    out.push({ id: `opt${out.length + 1}`, jobName, summary, bullets });
  }
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

function clampSummary(s: string): string {
  const cleaned = s.trim().replace(/\s+/g, " ");
  const words = cleaned.split(" ");
  return words.length <= 8 ? cleaned : words.slice(0, 8).join(" ");
}

function clampJobName(s: string): string {
  const cleaned = s.trim().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(
    /\s+/g,
    " ",
  );
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

/**
 * Heuristic fallback when the LLM is unavailable or returns garbage.
 * Splits the raw text into bullet-ish lines and produces three light
 * variations so the picker screen still functions.
 */
function fallbackOptions(raw: string): JobOption[] {
  const lines = raw
    .split(/[\n.;]+/)
    .map((l) => l.trim().replace(/\s+/g, " "))
    .filter((l) => l.length > 0);
  const base = (lines.length > 0 ? lines : [raw.trim()]).slice(0, 4);
  const summary = clampSummary(base[0] || "New job");
  const jobName = deriveJobName(summary);
  const single: JobOption = { id: "opt1", jobName, summary, bullets: base };
  // Three near-identical options so the UI shows the expected count; the
  // contractor edits/picks one. Cleanup line added on the broader variants.
  return [
    single,
    { id: "opt2", jobName, summary, bullets: base.slice(0, 3) },
    {
      id: "opt3",
      jobName,
      summary,
      bullets: [...base.slice(0, 3), "Jobsite cleanup"].slice(0, 4),
    },
  ];
}
