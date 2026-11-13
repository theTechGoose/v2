import { Inject, Injectable } from "#danet/core";
import {
  LLM_CLIENT,
  type LLMClient,
} from "@agents/domain/business/llm/base/mod.ts";
import { t } from "@core/i18n/mod.ts";
import { onlyDeletesWords } from "#quote-flow/polish-offer.ts";

export interface ProfessionalizeBulletInput {
  userId: string;
  /** The rough bullet text the contractor typed or edited. */
  text: string;
  /** REQ-332 (demo m30): the JOB the bullet belongs to — the contractor's
   *  original message and the other bullets of the option — so a one-line
   *  rewrite never re-scopes a job-wide item ("City of Austin permit") onto
   *  the item it happens to share a line with. Context only; never rewritten. */
  context?: { raw?: string; siblings?: string[] };
}

export interface ProfessionalizeBulletResult {
  /** The first clean scope-of-work line (legacy single-line consumers). */
  text: string;
  /** REQ-332: every line the bullet became — an "A + B" bullet that names
   *  two separate items comes back as two lines, never merged into one. */
  lines: string[];
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
    // REQ-332: the separate items a "+"-joined bullet names. They must come
    // back as that many lines — the model may not fold them into one.
    const items = splitJoinedItems(text);
    const fallback = () => {
      const lines = items.map(professionalizeFallback);
      return { text: lines[0], lines };
    };

    let raw: string;
    try {
      const res = await this.llm.respond({
        systemPrompt: SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: buildUserContent(text, input.context),
        }],
        userId: input.userId,
      });
      raw = res.text ?? "";
    } catch (err) {
      console.error("[professionalize-bullet] llm call failed:", err);
      return fallback();
    }

    const parsed = tryParseJson(raw);
    const candidates =
      (Array.isArray(parsed?.lines)
        ? parsed.lines.filter((l): l is string => typeof l === "string")
        : typeof parsed?.text === "string"
        ? [parsed.text]
        : [stripLine(raw) || text])
        .map(tidy)
        .filter((l) => l.length > 0)
        .slice(0, 6);
    // Scope-faithfulness gate: every professionalized line must still be
    // ABOUT the bullet it came from. A reply that shares no content word
    // with the input (the dev stub's "(stub) Rough bullet:" echo, a refusal
    // preamble, or a hallucinated unrelated scope) is discarded in favor of
    // the deterministic rewrite — same fallback discipline as
    // polish-job-details. REQ-332: an "A + B" bullet must come back as one
    // line per item, each about ITS item — "Install 4 recessed lights with
    // permit" for "4 recesed lights + City of Austin permit" is overruled.
    const faithful = items.length > 1
      ? candidates.length === items.length &&
        candidates.every((l, i) => isFaithfulTo(l, items[i]))
      : candidates.length > 0 && candidates.every((l) => isFaithfulTo(l, text));
    if (!faithful) return fallback();
    // REQ-675 (cycle 5, p18-7b): a single line that only deletes words of the
    // bullet ("…tile with dark grout" → "…tile dark grout") is not a polish.
    // Hand the bullet back as written, so the client offers nothing.
    if (
      items.length === 1 && candidates.length === 1 &&
      onlyDeletesWords(text, candidates[0])
    ) {
      return { text, lines: [text] };
    }
    return { text: candidates[0], lines: candidates };
  }
}

function tidy(s: string): string {
  return s.replace(/\s+/g, " ").replace(/[.;]+$/, "").trim();
}

/** REQ-332: "4 recesed lights + City of Austin permit" → two items. Only an
 *  explicit joiner ("+", "plus") splits; "and" is left to the model, since
 *  "tile, vanity and glass" is one install.
 *  REQ-443 (demo m46): only a TOP-LEVEL joiner splits — one inside (), [] or
 *  {} belongs to its parenthetical ("island (trench + patch)" is one item) —
 *  and only when every piece names an item of its own (has a letter). */
export function splitJoinedItems(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  const joiner = /\s*\+\s*|\s+plus\s+/iy;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if ((ch === ")" || ch === "]" || ch === "}") && depth > 0) depth--;
    if (depth > 0) continue;
    joiner.lastIndex = i;
    const m = joiner.exec(text);
    if (!m) continue;
    parts.push(text.slice(start, i));
    start = i + m[0].length;
    i = start - 1;
  }
  parts.push(text.slice(start));
  const items = parts.map((p) => p.trim());
  const real = items.every((p) => /\p{L}/u.test(p));
  return items.length > 1 && real ? items : [text];
}

/** The bullet first (the stub echoes the first line, which the gate then
 *  rejects as before), then the job it belongs to, marked as context. */
function buildUserContent(
  text: string,
  ctx?: ProfessionalizeBulletInput["context"],
): string {
  let content = `Rough bullet:\n${text}`;
  const siblings = (ctx?.siblings ?? []).map((s) => s.trim()).filter((s) =>
    s && s !== text
  );
  if (siblings.length) {
    content +=
      `\n\nThe other lines of this job (context only — do NOT rewrite, merge into, or restate these):\n` +
      siblings.map((s) => `- ${s}`).join("\n");
  }
  const raw = ctx?.raw?.trim();
  if (raw) {
    content += `\n\nContractor's original message (context only):\n${raw}`;
  }
  return content;
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

function tryParseJson(
  s: string,
): { text?: unknown; lines?: unknown } | undefined {
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
