import { Inject, Injectable } from "#danet/core";
import { LLM_CLIENT, type LLMClient } from "@agents/domain/business/llm/base/mod.ts";

export interface ProfessionalizeBulletInput {
  userId: string;
  /** The rough bullet text the contractor typed or edited. */
  text: string;
}

export interface ProfessionalizeBulletResult {
  /** One clean scope-of-work line. */
  text: string;
}

const SYSTEM_PROMPT =
  `You rewrite a contractor's rough scope-of-work bullet into ONE clean, professional line a customer reads on a quote.

OUTPUT — return JSON only, no prose, no code fences:
  { "text": "<one clean scope line>" }

RULES:
- One short line, roughly 3–8 words. No sentences, no trailing period.
- Third-person scope language ("Remove flooring, drywall & cabinets"), never first-person ("I'll rip out…").
- Use only what the contractor wrote. Do NOT invent materials, scope, square footage, or warranties.
- Fix typos and expand unambiguous shorthand. No emojis, no hype, no marketing language.
- If the input is already clean, return it essentially unchanged.
`;

/**
 * ProfessionalizeBullet — single-line LLM pass for the "Job Details"
 * picker screen. When the contractor edits a bullet (or adds a custom
 * one), the UI offers to professionalize it; this turns the rough text
 * into one tidy scope line.
 */
@Injectable()
export class ProfessionalizeBullet {
  constructor(@Inject(LLM_CLIENT) private llm: LLMClient) {}

  async run(input: ProfessionalizeBulletInput): Promise<ProfessionalizeBulletResult> {
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
      return { text };
    }

    const parsed = tryParseJson(raw);
    const cleaned = typeof parsed?.text === "string" && parsed.text.trim()
      ? parsed.text.trim()
      : stripLine(raw) || text;
    return { text: cleaned.replace(/\s+/g, " ").replace(/[.;]+$/, "") };
  }
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
  const first = s.split(/\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  return first.replace(/^["'•\-•\s]+/, "").replace(/["']+$/, "").trim();
}
