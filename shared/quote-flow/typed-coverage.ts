/**
 * REQ-439 (demo-loop cycle 3, issue M9) — what the contractor TYPED is the
 * yardstick for a job's lines. Pair 7's kitchen options all dropped "22 lf",
 * "48 sq ft", "35 sq ft", "3x6" and the slab drain; pair 2's lawn job lost
 * "4 cuartos de acre"; the master-bath first draft lost the shower bench and
 * the mold allowance. REQ-400's check (partitionByCoverage) compares options
 * with EACH OTHER, so an item every option dropped was invisible to it.
 *
 *   typedScopeItems  — the typed lines and their comma parts, customer out
 *   typedWorkItems   — those that are work: no price, schedule, payment or
 *                      address talk, no bare name, no chat command ("draft
 *                      the quote")
 *   typedQuantities  — the numbers, measurements and quantities they carry
 *                      (never a price, a duration, a year, a street number)
 *   missingQuantities / missedTypedItems — what a set of lines leaves out
 *   bulletFor / withQuantity — put a missing quantity back into the line
 *                      that names its item
 *
 * Pure and deterministic; shared by the job-options coordinator and the chat
 * coordinator's first-draft check.
 */
import {
  type CustomerFacts,
  distinctScopeItems,
  sameTerm,
  scopeTerms,
  stripCustomerDetails,
} from "./option-bullets.ts";
import { scopeBulletsFromRaw, type ScopeLang } from "./scope-from-raw.ts";

/** The items the contractor typed — the message's lines and their
 *  comma-separated parts, without the customer's name, contact or a
 *  duration part (REQ-400). */
export function typedScopeItems(
  raw: string,
  lang: ScopeLang = "en",
  facts: CustomerFacts = {},
): string[] {
  const scoped = scopeBulletsFromRaw(raw ?? "", lang);
  if (scoped.degraded) return [];
  const parts = scoped.bullets
    .flatMap((line) => line.split(/\s*,\s+/))
    .map((part) => stripCustomerDetails(part, facts))
    .filter((part): part is string => !!part);
  return distinctScopeItems(parts);
}

function plain(s: string): string {
  return (s ?? "").normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
}

/** Price talk: "yo pienso como 18 mil", "what should I charge", "$2k". */
const MONEY_TALK =
  /\b(?:precio|price|pricing|charge|cobr\w*|budget|presupuesto|cuanto|how much|dollars?|dolares|bucks|pesos)\b|\d\s*(?:k|mil)\b|\$/;
/** Schedule talk: "Empezamos después de Año Nuevo", "about 3 weeks". */
const SCHEDULE_TALK =
  /\b(?:after|before|despues|antes|start\w*|empez\w*|comenz\w*|empiez\w*|inici\w*|timeline|deadline|asap|schedule\w*|new year|ano nuevo|navidad|christmas|next (?:week|month)|la proxima|semanas?|weeks?|months?|mes|meses|days?|dias?|hours?|horas?)\b/;
/** Payment and address talk: "half deposit", "zip 78745" — terms, not
 *  work. */
const TERMS_TALK =
  /\b(?:deposit\w*|deposito|anticipo|adelanto|upfront|payment|pago|pay|paid|net \d+|cash|efectivo|check|cheque|venmo|zelle|invoice|factura|zip|codigo postal|address|direccion|domicilio)\b/;
/** A name on its own: "Maria Gutierrez" (two or three capitalized words). */
const NAME_ONLY = /^\p{Lu}[\p{L}'’.-]*(?:\s+\p{Lu}[\p{L}'’.-]*){1,2}$/u;
/** Words of a chat command, not of a job: "draft the quote", "send it". */
const COMMAND_TERMS = new Set([
  "draft",
  "quote",
  "quotes",
  "cotizacion",
  "cotizar",
  "presupuesto",
  "estimate",
  "make",
  "create",
  "write",
  "send",
  "lock",
  "please",
  "thanks",
  "hazme",
  "haz",
  "manda",
  "enviar",
  "dime",
  "pienso",
  "think",
]);

/** One typed item is work on the job — not a price, a schedule, a question
 *  or a chat command. */
function isWorkItem(item: string): boolean {
  const p = plain(item);
  if (
    p.includes("?") || MONEY_TALK.test(p) || SCHEDULE_TALK.test(p) ||
    TERMS_TALK.test(p) || NAME_ONLY.test(item.trim())
  ) {
    return false;
  }
  const terms = scopeTerms(item);
  return terms.length > 0 && terms.some((t) => !COMMAND_TERMS.has(t));
}

/** The typed items that are work on the job, in order. */
export function typedWorkItems(
  raw: string,
  lang: ScopeLang = "en",
  facts: CustomerFacts = {},
): string[] {
  return typedScopeItems(withoutCostStatements(raw), lang, facts)
    .filter(isWorkItem);
}

/** "Ray the plumber is $2800", "el material cuesta unos $900": what a thing
 *  costs the contractor (REQ-261) — never an item the job must list. */
const COST_STATEMENT =
  /\b(?:is|are|was|were|es|son|cobra|cobran|charges?|costs?|cuesta|cuestan|runs?)\s+(?:me\s+)?(?:about|around|like|como|unos|unas|maybe)?\s*\$\s?\d/i;

function withoutCostStatements(raw: string): string {
  return (raw ?? "").split("\n").map((line) =>
    line.split(/(?<=[.!?;])\s+/).filter((s) => !COST_STATEMENT.test(s))
      .join(" ")
  ).join("\n");
}

// ── Quantities ─────────────────────────────────────────────────────────────

export interface TypedQuantity {
  /** What a line must carry: the number as typed, spaces off, "×" → "x",
   *  a decimal comma → "." ("22", "3x6", "4.5"). */
  key: string;
  /** The quantity as typed, with its unit or the words it counts ("22 lf",
   *  "48 sq ft", "4 cuartos de acre", "5 LED strips"). */
  text: string;
  /** True when `text` ends in a unit ("lf", "sq ft", '"'); false when it
   *  names the things counted ("4 recessed lights"). */
  unit: boolean;
  /** The typed item it sits in — the line it belongs to. */
  item: string;
}

/** Units, longest first (matched on the accent-free, lowercased text). */
const UNITS = [
  "cuartos de acre",
  "cuarto de acre",
  "quarter acres?",
  "pies cuadrados",
  "pies lineales",
  "metros cuadrados",
  "metros lineales",
  "square (?:feet|foot|ft|yards?)",
  "linear (?:feet|foot|ft)",
  "lineal (?:feet|foot|ft)",
  "sq\\.? ?(?:ft|feet|yds?|m)",
  "lin\\.? ?ft",
  "ln\\.? ?ft",
  "cu\\.? ?(?:yds?|ft)",
  "cubic (?:yards?|feet)",
  "sqft",
  "sf",
  "lf",
  "ft",
  "feet",
  "foot",
  "inch(?:es)?",
  "in",
  "yards?",
  "yds?",
  "yd",
  "acres?",
  "gal(?:lons?|ones)?",
  "galon",
  "pies",
  "pie",
  "pulgadas?",
  "metros?",
  "mts?",
  "m2",
  "m",
  "cm",
  "mm",
  "lbs?",
  "tons?",
  "toneladas?",
  '"',
  "'",
  "”",
  "″",
  "′",
];
const UNIT_RE = new RegExp(
  `^\\s?(?:${UNITS.join("|")})(?![\\p{L}\\p{N}])`,
  "u",
);
/** Not a quantity when one of these follows: money, a duration, a time, an
 *  ordinal, a percentage. */
const NOT_QTY_AFTER =
  /^\s*-?\s*(?:k\b|mil\b|grand\b|dollars?|dolares|usd|bucks|pesos|%|percent|por ciento|(?:hours?|hrs?|days?|weeks?|wks?|months?|mos?|years?|yrs?|horas?|dias?|semanas?|meses|mes|anos?)\b|(?:am|pm|a\.m|p\.m)\b|:\d|(?:st|nd|rd|th|ro|do|er|vo|to)\b)/;
/** A street number: "412 Oak St", "1200 Barton Hills Dr". */
const STREET_AFTER =
  /^\s+(?:[\p{L}.'-]+\s+){1,3}(?:st|street|ave|avenue|dr|drive|rd|road|blvd|ln|lane|way|ct|court|pl|place|cir|circle|pkwy|hwy|trl|calle|avenida)\b/u;
const NUMBER =
  /(?<![\p{L}\p{N}$.,/:#-])(\d+(?:[.,]\d+)?(?:\s*[x×]\s*\d+(?:[.,]\d+)?)*)(?![\d/]|[.,]\d)/gu;
/** Words that end a counted phrase ("5 LED strips for the island"). */
const STOP_WORDS = new Set([
  "of",
  "de",
  "del",
  "for",
  "para",
  "with",
  "con",
  "and",
  "y",
  "in",
  "en",
  "on",
  "at",
  "to",
  "a",
  "the",
  "el",
  "la",
  "los",
  "las",
  "or",
  "o",
  "plus",
  "under",
  "debajo",
  "around",
]);

function keyOf(num: string): string {
  return num.replace(/\s+/g, "").replace(/×/g, "x").replace(/,/g, ".")
    .toLowerCase();
}

/** The quantities one typed item carries. */
function quantitiesIn(item: string): TypedQuantity[] {
  const out: TypedQuantity[] = [];
  for (const m of item.matchAll(NUMBER)) {
    const num = m[1];
    const at = (m.index ?? 0) + m[0].length;
    const rest = item.slice(at);
    const restPlain = plain(rest);
    if (NOT_QTY_AFTER.test(restPlain) || STREET_AFTER.test(rest)) continue;
    const unit = restPlain.match(UNIT_RE);
    const key = keyOf(num);
    if (unit) {
      out.push({
        key,
        text: `${num}${rest.slice(0, unit[0].length)}`.trim(),
        unit: true,
        item,
      });
      continue;
    }
    // a bare 4-digit number or bigger with no unit: a year, a ZIP, a price
    if (/^\d{4,}$/.test(key)) continue;
    const words: string[] = [];
    for (const w of rest.trim().split(/\s+/)) {
      const word = w.replace(/[^\p{L}\p{N}-]+$/u, "");
      if (!word || STOP_WORDS.has(plain(word)) || !/\p{L}/u.test(word)) break;
      words.push(word);
      if (words.length === 2 || word !== w) break;
    }
    out.push({
      key,
      text: [num, ...words].join(" "),
      unit: false,
      item,
    });
  }
  return out;
}

/** Every quantity the typed work items carry, each key once, in order. */
export function typedQuantities(
  raw: string,
  lang: ScopeLang = "en",
  facts: CustomerFacts = {},
): TypedQuantity[] {
  const seen = new Set<string>();
  const out: TypedQuantity[] = [];
  for (const q of typedWorkItems(raw, lang, facts).flatMap(quantitiesIn)) {
    if (seen.has(q.key)) continue;
    seen.add(q.key);
    out.push(q);
  }
  return out;
}

const NUMBER_WORDS: Record<string, string[]> = {
  "1": ["one", "uno", "una", "un"],
  "2": ["two", "dos", "pair", "par"],
  "3": ["three", "tres"],
  "4": ["four", "cuatro"],
  "5": ["five", "cinco"],
  "6": ["six", "seis"],
  "7": ["seven", "siete"],
  "8": ["eight", "ocho"],
  "9": ["nine", "nueve"],
  "10": ["ten", "diez"],
  "11": ["eleven", "once"],
  "12": ["twelve", "doce"],
};

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when `line` carries the quantity — as typed, spaced differently
 *  ("3 x 6"), or spelled out ("five"). */
export function carriesQuantity(line: string, q: TypedQuantity): boolean {
  const norm = plain(line).replace(/(\d)\s*[x×]\s*(?=\d)/g, "$1x")
    .replace(/(\d),(?=\d)/g, "$1.");
  const digits = new RegExp(`(?<![\\d.])${escapeRe(q.key)}(?![\\d]|\\.\\d)`);
  if (digits.test(norm)) return true;
  const words = NUMBER_WORDS[q.key];
  return !!words &&
    words.some((w) =>
      new RegExp(`(?<![\\p{L}])${w}(?![\\p{L}])`, "u").test(norm)
    );
}

/** The typed quantities no line in `lines` carries. */
export function missingQuantities(
  lines: readonly string[],
  quantities: readonly TypedQuantity[],
): TypedQuantity[] {
  return quantities.filter((q) => !lines.some((l) => carriesQuantity(l, q)));
}

// ── Items ──────────────────────────────────────────────────────────────────

function shared(a: readonly string[], b: readonly string[]): number {
  return a.filter((t) => b.some((s) => sameTerm(s, t))).length;
}

/** What tells each typed item apart: its terms no other typed item shares
 *  ("Banco en la regadera" → "banco": the shower line also says
 *  "regadera"). An item with nothing of its own keeps all its terms. */
function keyTerms(items: readonly string[]): string[][] {
  const all = items.map(scopeTerms);
  return all.map((terms, i) => {
    const own = terms.filter((t) =>
      !all.some((other, j) => j !== i && other.some((o) => sameTerm(o, t)))
    );
    return own.length ? own : terms;
  });
}

/** True when one line names the item: it holds a third (at least one) of
 *  the item's own terms. */
function names(line: string, key: readonly string[]): boolean {
  if (key.length === 0) return true;
  return shared(key, scopeTerms(line)) >=
    Math.max(1, Math.ceil(key.length / 3));
}

/** The typed items no single line in `lines` names. */
export function missedTypedItems(
  lines: readonly string[],
  items: readonly string[],
): string[] {
  const keys = keyTerms(items);
  return items.filter((_, i) => !lines.some((l) => names(l, keys[i])));
}

/** The index of the line that best names the quantity's item, or -1. */
export function bulletFor(
  lines: readonly string[],
  q: TypedQuantity,
): number {
  const item = scopeTerms(q.item);
  let best = -1;
  let score = 0;
  lines.forEach((line, i) => {
    const s = shared(item, scopeTerms(line));
    if (s > score) {
      best = i;
      score = s;
    }
  });
  return best;
}

/**
 * The line with the quantity put back: before the thing it counts when the
 * line names that thing ("Exhaust fan and recessed lights" + "4 recessed
 * lights" → "Exhaust fan and 4 recessed lights"), else in parentheses at the
 * end ("Install shaker cabinets (22 lf)"). A line that already carries it,
 * or carries another number in the same unit (a correction changed it), is
 * left alone.
 */
export function withQuantity(line: string, q: TypedQuantity): string {
  if (carriesQuantity(line, q)) return line;
  if (q.unit) {
    const unit = q.text.slice(q.text.search(/[^\d.,x×\s]/)).trim();
    if (
      unit &&
      new RegExp(`\\d\\s?${escapeRe(plain(unit))}(?![\\p{L}])`, "u").test(
        plain(line),
      )
    ) return line;
  } else {
    const noun = q.text.split(" ")[1];
    if (noun) {
      const re = new RegExp(
        `(?<![\\p{L}\\p{N}])(${escapeRe(noun)})(?![\\p{L}])`,
        "iu",
      );
      if (re.test(line)) return line.replace(re, `${q.key} $1`);
    }
  }
  return `${line} (${q.text})`;
}
