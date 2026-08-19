import { Inject, Injectable } from "#danet/core";
import {
  LLM_CLIENT,
  type LLMClient,
} from "@agents/domain/business/llm/base/mod.ts";
import { t } from "@core/i18n/mod.ts";

export interface ProfessionalizeBulletInput {
  userId: string;
  /** The rough bullet text the contractor typed or edited. */
  text: string;
}

export interface ProfessionalizeBulletResult {
  /** One clean scope-of-work line. */
  text: string;
}

const SYSTEM_PROMPT = t("en", "prompts.professionalizeBullet");

/**
 * ProfessionalizeBullet — single-line LLM pass for the "Job Details"
 * picker screen. When the contractor edits a bullet (or adds a custom
 * one), the UI offers to professionalize it; this turns the rough text
 * into one tidy scope line.
 */
@Injectable()
export class ProfessionalizeBullet {
  constructor(@Inject(LLM_CLIENT) private llm: LLMClient) {}

  async run(
    input: ProfessionalizeBulletInput,
  ): Promise<ProfessionalizeBulletResult> {
    const text = input.text.trim();
    if (!text) throw new Error("text is required");

    let raw: string;
    try {
      const res = await this.llm.respond({
        systemPrompt: SYSTEM_PROMPT,
        messages: [{ role: "user", content: `Rough bullet:\n${text}` }],
        userId: input.userId,
      });
      raw = res.text ?? "";
    } catch (err) {
      console.error("[professionalize-bullet] llm call failed:", err);
      return { text: professionalizeFallback(text) };
    }

    const parsed = tryParseJson(raw);
    const cleaned = typeof parsed?.text === "string" && parsed.text.trim()
      ? parsed.text.trim()
      : stripLine(raw) || text;
    // Scope-faithfulness gate: a professionalized line must still be ABOUT
    // the bullet it came from. A reply that shares no content word with the
    // input (the dev stub's "(stub) Rough bullet:" echo, a refusal preamble,
    // or a hallucinated unrelated scope) is discarded in favor of the
    // deterministic rewrite — same fallback discipline as polish-job-details.
    const line = isFaithfulTo(cleaned, text)
      ? cleaned
      : professionalizeFallback(text);
    return { text: line.replace(/\s+/g, " ").replace(/[.;]+$/, "") };
  }
}

/** Words too generic to prove a line is about the same job. */
const FILLER = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "for",
  "with",
  "in",
  "on",
  "el",
  "la",
  "los",
  "las",
  "de",
  "del",
  "y",
  "o",
  "un",
  "una",
  "para",
  "por",
  "con",
  "en",
  "al",
  "old",
  "new",
]);

/** True when the candidate keeps at least one content word of the input
 *  (case-insensitive). Inputs with no content words can't be judged and
 *  pass through. */
function isFaithfulTo(candidate: string, input: string): boolean {
  const significant = input
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2 && !FILLER.has(w));
  if (significant.length === 0) return true;
  const hay = candidate.toLowerCase();
  return significant.some((w) => hay.includes(w));
}

/** Deterministic professional rewrite of a rough bullet — the offline/stub
 *  fallback. Maps casual leading verb phrases onto scope-of-work phrasing
 *  and keeps every content word, so the proposal is a real transformation
 *  that can never drift off the described job. */
const VERB_REWRITES: Array<[RegExp, string]> = [
  [
    /^(tear (out|down|off)|rip (out|off)|demolish|demo)\b/i,
    "Demolition and removal of",
  ],
  [/^(haul (away|off)|dispose of)\b/i, "Haul-away and disposal of"],
  [/^(put (up|in)|install|mount|hang)\b/i, "Installation of"],
  [/^(fix|repair|mend)\b/i, "Repair of"],
  [/^(replace|swap( out)?)\b/i, "Replacement of"],
  [/^(paint|repaint)\b/i, "Painting of"],
  [/^(clean( up)?|cleanup)\b/i, "Cleanup of"],
  [/^(build|construct)\b/i, "Construction of"],
];

function professionalizeFallback(text: string): string {
  const clean = text
    .replace(/^\s*[-•*·]\s*/, "")
    .replace(/\s+/g, " ")
    .replace(/[.;]+$/, "")
    .trim();
  for (const [verb, label] of VERB_REWRITES) {
    const m = clean.match(verb);
    if (m) {
      const rest = clean.slice(m[0].length).trim();
      if (rest) return `${label} ${rest}`;
    }
  }
  // No recognized verb phrase — a tidy sentence-cased pass-through.
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function tryParseJson(s: string): { text?: unknown } | undefined {
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

/** Last-ditch: the model returned a bare line, not JSON. Take the first
 *  non-empty line and strip surrounding quotes/bullet glyphs. */
function stripLine(s: string): string {
  const first = s.split(/\n/).map((l) => l.trim()).find((l) => l.length > 0) ??
    "";
  return first.replace(/^["'•\-•\s]+/, "").replace(/["']+$/, "").trim();
}
