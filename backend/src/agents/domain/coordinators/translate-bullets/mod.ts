import { Inject, Injectable } from "#danet/core";
import {
  LLM_CLIENT,
  type LLMClient,
} from "@agents/domain/business/llm/base/mod.ts";
import { mentionsMoney } from "#quote-flow/private-cost.ts";

export interface TranslateBulletsInput {
  userId: string;
  /** Lines to translate (job-detail scope bullets). */
  texts: string[];
  /** Target language. */
  to: "en" | "es";
  /** REQ-333 (M24): the language the lines were written in. When it equals
   *  `to` there is nothing to translate — the lines come back verbatim and
   *  the model is never asked (it paraphrases "already-English" lines). */
  from?: "en" | "es";
}

export interface TranslateBulletsResult {
  /** Translated lines, same count + order as the input. */
  texts: string[];
  /** REQ-264: true only when `texts` came from the model — false when the
   *  call failed or the reply was unusable and `texts` are the originals,
   *  so callers can avoid caching an untranslated fallback. */
  translated?: boolean;
}

/**
 * TranslateBullets — translates the contractor's (possibly hand-edited)
 * job-detail bullets into the customer's language when the quote is built.
 * The "Job Details" picker shows options in the contractor's app language;
 * the customer's agreement renders in the comms language, so an edited or
 * added bullet is translated here so the two stay in sync. Falls back to the
 * originals on any LLM/parse failure (better a one-language bullet than none).
 */
@Injectable()
export class TranslateBullets {
  constructor(@Inject(LLM_CLIENT) private llm: LLMClient) {}

  async run(input: TranslateBulletsInput): Promise<TranslateBulletsResult> {
    const texts = (input.texts ?? []).map((t) => (t ?? "").trim()).filter(
      Boolean,
    );
    if (texts.length === 0) return { texts: [], translated: true };
    // REQ-333 (M24): same language in and out is not a translation. The
    // prompt's "return it unchanged" is not a guarantee — gpt-4o-mini turned
    // "Demo and haul-off" into "Demolition and removal" — so the short-circuit
    // is code, not prose.
    if (input.from === input.to) return { texts, translated: true };
    const target = input.to === "es"
      ? "neutral Latin-American Spanish"
      : "English";
    const sys =
      `You translate short construction scope-of-work bullet lines into ${target}. ` +
      `Preserve meaning and trade terminology; keep each concise (3–8 words), third-person, no trailing period. ` +
      `Return JSON ONLY: {"texts":["...","..."]} — the SAME number of lines, in the SAME order. ` +
      `If a line is already in ${target}, return it unchanged.`;

    let raw: string;
    try {
      const res = await this.llm.respond({
        systemPrompt: sys,
        messages: [{ role: "user", content: JSON.stringify({ texts }) }],
        userId: input.userId,
        // REQ-264 (M15) / REQ-260 (M24): JSON mode — without it the OpenAI
        // client attaches the chat tools and a tool call silently returns
        // the originals (no text).
        responseFormat: "json",
      });
      raw = res.text ?? "";
    } catch (err) {
      console.error("[translate-bullets] llm call failed:", err);
      return { texts, translated: false };
    }

    const parsed = tryParseJson(raw);
    const out = Array.isArray(parsed?.texts)
      ? parsed.texts
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.trim().replace(/\s+/g, " ").replace(/[.;]+$/, ""))
      : [];
    // Length mismatch ⇒ the model dropped/merged lines; fall back to the
    // originals rather than risk misaligned bullets.
    if (out.length !== texts.length) return { texts, translated: false };
    // REQ-261 (M26): a translation that ADDS a money amount the source line
    // did not have is the model pulling a private cost into customer copy.
    const addsMoney = out.some((o, i) =>
      mentionsMoney(o) && !mentionsMoney(texts[i])
    );
    return addsMoney
      ? { texts, translated: false }
      : { texts: out, translated: true };
  }
}

function tryParseJson(s: string): { texts?: unknown } | undefined {
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
