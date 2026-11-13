import { Inject, Injectable } from "#danet/core";
import {
  LLM_CLIENT,
  type LLMClient,
} from "@agents/domain/business/llm/base/mod.ts";
import { mentionsMoney } from "#quote-flow/private-cost.ts";
import { ES_TRADE_GLOSSARY } from "@agents/domain/business/es-trade-glossary/mod.ts";

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
  /** REQ-447 (demo-loop cycle 3, m14): indexes (0-based) of lines that are
   *  the job's TITLE, not scope lines — the model gives the short noun phrase
   *  a contractor would name the job with, not a word-for-word rendering. */
  titleLines?: readonly number[];
}

export interface TranslateBulletsResult {
  /** Translated lines, same count + order as the input. */
  texts: string[];
  /** REQ-264: true only when `texts` came from the model — false when the
   *  call failed or the reply was unusable and `texts` are the originals,
   *  so callers can avoid caching an untranslated fallback. */
  translated?: boolean;
}

/** REQ-350 / REQ-448: the shared Spanish trade glossary (one fragment for
 *  every Spanish-writing prompt) — re-exported for existing importers. */
export { ES_TRADE_GLOSSARY };

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
    // REQ-410 (demo-loop cycle 2, M24): a translation keeps every clause.
    // The old "keep each concise (3–8 words)" budget belongs to generation,
    // not translation — it cut "(faucets supplied by client)" out of the
    // customer's Spanish agreement.
    const sys =
      `You translate construction scope-of-work bullet lines into ${target}. ` +
      `Translate faithfully, clause by clause: never shorten, never summarize, and never drop parentheticals, ` +
      `exclusions ("not included", "excluded"), quantities, sizes, or who-supplies-what ("supplied by client/owner"). ` +
      `Keep trade terminology precise, third-person, no trailing period. ` +
      // REQ-594 (demo-loop cycle 4, m40): "keep trade terminology" let the
      // model leave "soffit" in English inside the Spanish copy.
      `Translate trade nouns into ${target} too (e.g. soffit, kitchen sink) — leave a term untranslated only when ${target} has no word for it. ` +
      `Return JSON ONLY: {"texts":["...","..."]} — the SAME number of lines, in the SAME order. ` +
      `If a line is already entirely in ${target}, return it unchanged; a line mixing languages is translated in full.` +
      (input.to === "es" ? ` ${ES_TRADE_GLOSSARY}` : "") +
      titleInstruction(input.titleLines ?? [], texts.length, input.to);

    const first = await this.ask(sys, texts, input.userId);
    if (first === undefined) return { texts, translated: false };
    const dropped = droppedLines(texts, first);
    // REQ-669 (demo-loop cycle 5, m52): "Guttar baño principal 8x10" — an
    // English stem with a Spanish ending — and a "double vanity" that lost
    // its "doble" were cached as a good translation.
    const suspect = suspectLines(texts, first, input.to);
    if (dropped.length === 0 && suspect.length === 0) {
      return { texts: first, translated: true };
    }
    // REQ-410 / REQ-669: one retry that names what went wrong.
    const retrySys = sys +
      (dropped.length > 0
        ? ` Your previous reply dropped content from line(s) ${
          dropped.map((i) => i + 1).join(", ")
        } — translate EVERY clause, including the parenthetical / exclusion.`
        : "") +
      suspect.map((s) => retryNote(s, texts[s.line], target)).join("");
    const second = await this.ask(retrySys, texts, input.userId);
    if (second !== undefined && droppedLines(texts, second).length === 0) {
      // A word that is still not Spanish is not trusted: the base text shows
      // with the UX-06 notice and the next preview asks again. A quantity
      // still missing after the retry is a smaller harm than no translation.
      const coined = suspectLines(texts, second, input.to).some((s) =>
        s.coined.length > 0
      );
      return coined
        ? { texts, translated: false }
        : { texts: second, translated: true };
    }
    // REQ-410: a second short reply is not trusted. A first reply that only
    // lost a quantity (no dropped clause, no coined word) still beats none.
    if (
      dropped.length === 0 && suspect.every((s) => s.coined.length === 0)
    ) {
      return { texts: first, translated: true };
    }
    return { texts, translated: false };
  }

  /** One model round-trip; `undefined` when the reply is unusable (call
   *  failed, wrong line count, or an added money amount). */
  private async ask(
    sys: string,
    texts: string[],
    userId: string,
  ): Promise<string[] | undefined> {
    let raw: string;
    try {
      const res = await this.llm.respond({
        systemPrompt: sys,
        messages: [{ role: "user", content: JSON.stringify({ texts }) }],
        userId,
        // REQ-264 (M15) / REQ-260 (M24): JSON mode — without it the OpenAI
        // client attaches the chat tools and a tool call silently returns
        // the originals (no text).
        responseFormat: "json",
      });
      raw = res.text ?? "";
    } catch (err) {
      console.error("[translate-bullets] llm call failed:", err);
      return undefined;
    }

    const parsed = tryParseJson(raw);
    const out = Array.isArray(parsed?.texts)
      ? parsed.texts
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.trim().replace(/\s+/g, " ").replace(/[.;]+$/, ""))
      : [];
    // Length mismatch ⇒ the model dropped/merged lines; fall back to the
    // originals rather than risk misaligned bullets.
    if (out.length !== texts.length) return undefined;
    // REQ-261 (M26): a translation that ADDS a money amount the source line
    // did not have is the model pulling a private cost into customer copy.
    const addsMoney = out.some((o, i) =>
      mentionsMoney(o) && !mentionsMoney(texts[i])
    );
    return addsMoney ? undefined : out;
  }
}

/**
 * REQ-447 (demo-loop cycle 3, m14): the job name rides the lines' batch but
 * is a TITLE. Translated clause by clause, "Cambio de llave de fregadero"
 * became "Replacement of Faucet" and the agreement read "María José Peña's
 * Replacement of Faucet Agreement". Name the title line(s) (1-based, as the
 * model counts) and ask for the noun phrase a contractor would use.
 */
export function titleInstruction(
  titleLines: readonly number[],
  count: number,
  to: "en" | "es",
): string {
  const lines = titleLines.filter((i) => i >= 0 && i < count);
  if (lines.length === 0) return "";
  const example = to === "es"
    ? `"Cambio de llave", "Reparación de techo"`
    : `"Faucet Replacement", "Roof Repair"`;
  const literal = to === "es"
    ? `"Reemplazo del grifo del fregadero"`
    : `"Replacement of Faucet"`;
  return lines.map((i) =>
    ` Line ${
      i + 1
    } is the job's TITLE, not a scope line: return the short noun phrase a contractor would name this job with in that language (e.g. ${example}), 2–4 words, never a word-for-word rendering like ${literal}.`
  ).join("");
}

/**
 * REQ-410 (M24): markers of a contract exclusion / who-supplies-what clause,
 * in either language. A source line carrying one is load-bearing: its
 * translation must not come back much shorter or without its parenthetical.
 */
const EXCLUSION_MARKER =
  /\(|supplied by|provided by|furnished by|not included|not incl|\bexcl|by (?:the )?(?:client|owner|customer|homeowner)|(?:client|owner|customer)[- ]supplied|no incluye|no incluido|excluid|suministrad[oa]s? por|proporcionad[oa]s? por|por (?:el|la) (?:client[ea]|dueñ[oa]|propietari[oa])|los pone|las pone/i;

/** The share of the source's characters a translation of a marked line must
 *  keep. EN↔ES run within ±20% of each other; a dropped clause is far below. */
export const MIN_KEPT_RATIO = 0.6;

/**
 * REQ-410 (M24): indexes of lines whose translation lost content — the source
 * carries an exclusion marker or a parenthetical, and the output is under
 * {@link MIN_KEPT_RATIO} of its length or lost its parenthetical. Plain lines
 * are not judged (a short translation of a short phrase is fine).
 */
export function droppedLines(src: string[], out: string[]): number[] {
  const bad: number[] = [];
  src.forEach((s, i) => {
    if (!EXCLUSION_MARKER.test(s)) return;
    const o = out[i] ?? "";
    const lostParen = s.includes("(") && !o.includes("(");
    if (lostParen || o.length < s.length * MIN_KEPT_RATIO) bad.push(i);
  });
  return bad;
}

/** REQ-669 (m52): one suspect line of a translation. */
export interface SuspectLine {
  /** 0-based index into the source / output lines. */
  line: number;
  /** Output words that are an English source word with a Spanish verb /
   *  participle ending ("Guttar" for "gut", "tilear" for "tile"). */
  coined: string[];
  /** Source quantity words / numbers missing from the output ("double",
   *  "8"). */
  lostQuantities: string[];
}

/** Spanish verb / participle endings a model bolts onto an English stem. */
const ES_ENDINGS = [
  "eando",
  "eados",
  "eadas",
  "eado",
  "eada",
  "ear",
  "ando",
  "ados",
  "adas",
  "ado",
  "ada",
  "ar",
] as const;

/** English words whose Spanish verb really is word + -ar / -ado ("plantar",
 *  "formar", "remodelar", "cableado") — never flagged as a coinage. */
const REAL_ES_COGNATE_STEMS = new Set([
  "adapt",
  "alarm",
  "arm",
  "bar",
  "cable",
  "cement",
  "consult",
  "contact",
  "detect",
  "document",
  "export",
  "fall",
  "form",
  "hall",
  "import",
  "inform",
  "insert",
  "invert",
  "limit",
  "mold",
  "orient",
  "panel",
  "peg",
  "plan",
  "plant",
  "present",
  "program",
  "remodel",
  "rent",
  "report",
  "rest",
  "segment",
  "sell",
  "sold",
  "tall",
  "tap",
  "transport",
  "visit",
]);

/** Quantity words that must survive a translation, per target language:
 *  source word → what the output must carry. */
const QUANTITY_WORDS: Record<"en" | "es", [RegExp, string, RegExp][]> = {
  es: [
    [/\bdouble\b/i, "double", /\bdobles?\b|\bdos\b|\b2\b/i],
    [/\btriple\b/i, "triple", /\btriples?\b|\btres\b|\b3\b/i],
    [/\btwin\b/i, "twin", /\bdobles?\b|\bgemel|\bdos\b|\b2\b/i],
    [
      /\bsingle\b/i,
      "single",
      /\bsencill|\bindividual|\bsimples?\b|\bun[oa]?\b|\b1\b/i,
    ],
  ],
  en: [
    [/\bdobles?\b/i, "doble", /\bdouble\b|\btwin\b|\btwo\b|\b2\b/i],
    [/\btriples?\b/i, "triple", /\btriple\b|\bthree\b|\b3\b/i],
    [/\bsencill[oa]s?\b/i, "sencillo", /\bsingle\b|\bone\b|\b1\b/i],
  ],
};

/** A number may come back spelled out ("2 bedrooms" → "dos recámaras"). */
const NUMBER_WORDS: Record<"en" | "es", string[]> = {
  es: [
    "cero",
    "un|uno|una",
    "dos",
    "tres",
    "cuatro",
    "cinco",
    "seis",
    "siete",
    "ocho",
    "nueve",
    "diez",
  ],
  en: [
    "zero",
    "one|a|an",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
  ],
};

function words(s: string): string[] {
  return (s.toLowerCase().match(/\p{L}+/gu) ?? []);
}

/** The English source word an output token was coined from, if any. */
function coinedFrom(token: string, src: Set<string>): string | undefined {
  const t = token.toLowerCase();
  if (src.has(t)) return undefined; // a name / brand kept verbatim
  for (const end of ES_ENDINGS) {
    if (!t.endsWith(end)) continue;
    const stem = t.slice(0, -end.length);
    const dedoubled = /(\p{L})\1$/u.test(stem) ? stem.slice(0, -1) : stem;
    for (const c of [stem, dedoubled]) {
      if (c.length >= 3 && src.has(c) && !REAL_ES_COGNATE_STEMS.has(c)) {
        return c;
      }
    }
  }
  return undefined;
}

/**
 * REQ-669 (demo-loop cycle 5, m52): lines whose translation is not trusted
 * as written — (to Spanish) an output word that is an English source word
 * with a Spanish ending ("Guttar" for "Gut"), or (both ways) a quantity word
 * ("double" → "doble") or a number the source carried that the output lost.
 */
export function suspectLines(
  src: string[],
  out: string[],
  to: "en" | "es",
): SuspectLine[] {
  const found: SuspectLine[] = [];
  src.forEach((s, i) => {
    const o = out[i] ?? "";
    const srcWords = new Set(words(s));
    const coined = to === "es"
      ? (o.match(/\p{L}+/gu) ?? []).filter((w) =>
        coinedFrom(w, srcWords) !== undefined
      )
      : [];
    const lostQuantities: string[] = [];
    for (const [has, name, keeps] of QUANTITY_WORDS[to]) {
      if (has.test(s) && !keeps.test(o)) lostQuantities.push(name);
    }
    const outNums = new Set(o.match(/\d+/g) ?? []);
    for (const n of s.match(/\d+/g) ?? []) {
      if (outNums.has(n)) continue;
      const spelled = NUMBER_WORDS[to][Number(n)];
      if (spelled && new RegExp(`\\b(?:${spelled})\\b`, "i").test(o)) continue;
      if (!lostQuantities.includes(n)) lostQuantities.push(n);
    }
    if (coined.length > 0 || lostQuantities.length > 0) {
      found.push({ line: i, coined, lostQuantities });
    }
  });
  return found;
}

/** REQ-669: the retry sentence for one suspect line. */
function retryNote(s: SuspectLine, source: string, target: string): string {
  const n = s.line + 1;
  const parts: string[] = [];
  if (s.coined.length > 0) {
    parts.push(
      ` Line ${n} used ${
        s.coined.map((w) => `"${w}"`).join(", ")
      }, which is not a ${target} word (a borrowed stem with a Spanish ending) — use the real ${target} term (see the glossary), e.g. gut → desmantelar.`,
    );
  }
  if (s.lostQuantities.length > 0) {
    parts.push(
      ` Line ${n} ("${source}") lost ${
        s.lostQuantities.map((q) => `"${q}"`).join(", ")
      } — keep every quantity word and number.`,
    );
  }
  return parts.join("");
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
