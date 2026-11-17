/**
 * REQ-767 (demo-loop cycle 5v2, m43 — the verifier's re-test of REQ-664).
 *
 * REQ-664 made a signed quote's line edit offer the change order it amounts
 * to — but only when the model called revise_quote with a line name that is
 * literally on the quote. On Carmen's signed Q-001 (one line, "Reparar fuga
 * debajo del fregadero …" $350) the verifier's "lower the line to $300" was
 * answered by the model in text ("…a $100 discount?", no button), and "the
 * sink repair line should be $400" named no line of the Spanish quote, so
 * the reply was the bare refusal again.
 *
 * Two pure rules close it:
 *   - `parseLineRepriceAsk` reads "<line> should be $X" / "lower|raise|change
 *     … <line> to $X" (en/es) in code, so the coordinator can answer a signed
 *     quote's reprice without the model;
 *   - `pickRepriceLine` finds the line it means: the most words in common
 *     with its wording in ANY language, else the quote's only line.
 */
import { lineKey } from "@agents/domain/business/quote-line-revision/mod.ts";

export interface LineRepriceAsk {
  /** The words that name the line, as typed ("the sink repair line"). */
  phrase: string;
  /** The line's new total, integer cents. */
  amountCents: number;
  /** An explicit "Q-001" in the message. */
  quoteNumber?: string;
}

const MONEY = String.raw`\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?!\s*%)`;
/** "<line> should be $400" / "… debe ser $400". */
const SHOULD_BE_RE = new RegExp(
  String
    .raw`^(.*?)\s*\b(?:should (?:be|cost)|is now|needs to be|has to be|debe ser|debería ser|deberia ser|tiene que ser|debe costar)\s+` +
    MONEY,
  "iu",
);
/** "lower the line to $300" / "baja la reparación a $300". */
const VERB_TO_RE = new RegExp(
  String
    .raw`\b(?:change|lower|raise|drop|reduce|bump|increase|decrease|set|update|adjust|cambia(?:r)?|baja(?:r)?|sube|subir|pon(?:er)?|ajusta(?:r)?|reduce|rebaja(?:r)?)\b\s*(.*?)\s*\b(?:to|a)\s+` +
    MONEY,
  "iu",
);
/** Asks about other documents and money flows — never a line's price. */
const OTHER_RE =
  /\b(?:invoice|INV-\d+|CO-\d+|change[- ]order|deposit|payment|paid|pay|factura|orden de cambio|anticipo|dep[oó]sito|pago|pagad[oa]|cobr\w*|total)\b/iu;

function cents(whole: string, frac: string | undefined): number {
  const dollars = Number(whole.replace(/,/g, ""));
  const c = frac ? Number(frac.padEnd(2, "0")) : 0;
  return dollars * 100 + c;
}

/** A line's new price in so many words, or undefined. */
export function parseLineRepriceAsk(text: string): LineRepriceAsk | undefined {
  const s = (text ?? "").trim();
  if (!s || OTHER_RE.test(s)) return undefined;
  const m = SHOULD_BE_RE.exec(s) ?? VERB_TO_RE.exec(s);
  if (!m) return undefined;
  const amountCents = cents(m[2], m[3]);
  if (!Number.isFinite(amountCents) || amountCents <= 0) return undefined;
  const quoteNumber = /\bQ-\d+\b/i.exec(s)?.[0].toUpperCase();
  return {
    phrase: m[1].trim(),
    amountCents,
    ...(quoteNumber ? { quoteNumber } : {}),
  };
}

/** Words that never name a line. */
const NOISE = new Set([
  "the",
  "a",
  "an",
  "and",
  "of",
  "on",
  "in",
  "for",
  "to",
  "my",
  "her",
  "his",
  "their",
  "s",
  "line",
  "item",
  "price",
  "cost",
  "quote",
  "update",
  "change",
  "el",
  "la",
  "los",
  "las",
  "un",
  "una",
  "de",
  "del",
  "en",
  "y",
  "partida",
  "precio",
  "cotizacion",
  "q",
]);

function stem(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) {
    return w.slice(0, -1);
  }
  return w;
}

function wordsOf(s: string): Set<string> {
  return new Set(
    lineKey(s).split(" ")
      .filter((w) => w && !NOISE.has(w) && !/^\d+$/.test(w))
      .map(stem),
  );
}

/**
 * The index of the line `phrase` means, or -1: the line sharing the most
 * words with it in any of its wordings (the description and each cached
 * translation); with no word in common, the quote's ONLY line. A tie is no
 * pick.
 */
export function pickRepriceLine(
  lines: readonly {
    description: string;
    descriptionByLang?: Record<string, string>;
  }[],
  phrase: string,
): number {
  const want = wordsOf(phrase);
  let best = -1;
  let bestScore = 0;
  let tie = false;
  lines.forEach((l, i) => {
    const have = new Set<string>();
    for (
      const text of [l.description, ...Object.values(l.descriptionByLang ?? {})]
    ) {
      if (typeof text === "string") wordsOf(text).forEach((w) => have.add(w));
    }
    const score = [...want].filter((w) => have.has(w)).length;
    if (score > bestScore) {
      best = i;
      bestScore = score;
      tie = false;
    } else if (score > 0 && score === bestScore) tie = true;
  });
  if (bestScore > 0) return tie ? -1 : best;
  return lines.length === 1 ? 0 : -1;
}
