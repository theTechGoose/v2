/**
 * REQ-315 (demo-loop cycle 1, M26) — the pure rules for changing lines that
 * are ALREADY on a quote.
 *
 * Demo pair 5 asked the assistant to "change plumbing fixtures to $1,300 on
 * Q-001". The only operation the assistant had for an existing job was
 * change_order, which appends `{description, price: delta}` — so the quote
 * got a FIFTH line, "Adjust plumbing fixtures to $1,300 ($150.00)". A reprice
 * must find the line the user named and change THAT line: same line count,
 * same order, new price (or wording), or the line gone.
 */

export interface RevisableLine {
  description: string;
  quantity?: number;
  unit?: string;
  /** Per-unit price in integer cents. */
  price?: number;
  /** REQ-264: cached translations of `description` — stale once it changes. */
  descriptionByLang?: Record<string, string>;
}

export interface LineChange {
  /** The existing line as the user referred to it ("plumbing fixtures"). */
  match: string;
  /** The line's new wording, when it changed. */
  description?: string;
  /** The line's NEW total in integer cents, when it changed. */
  amountCents?: number;
}

export interface LineRevision<T extends RevisableLine> {
  lineItems: T[];
  estimatedTotal: number;
  /** Names that matched no line. When any, `lineItems` is the input as it was. */
  unmatched: string[];
}

/** Lower-case, accents and punctuation gone, one space between words. */
export function lineKey(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "fixtures" → "fixture", "vanities" → "vanity"; "glass" stays. */
function stem(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) {
    return w.slice(0, -1);
  }
  return w;
}

/** Words that never identify a line on their own. */
const STOP = new Set([
  "the",
  "a",
  "an",
  "and",
  "of",
  "for",
  "line",
  "item",
  "el",
  "la",
  "los",
  "las",
  "un",
  "una",
  "de",
  "y",
  "partida",
]);

function words(key: string): string[] {
  return key.split(" ").filter((w) => w && !STOP.has(w)).map(stem);
}

export function totalOf(lines: readonly RevisableLine[]): number {
  return lines.reduce(
    (s, l) => s + (l.price ?? 0) * (l.quantity ?? 1),
    0,
  );
}

/**
 * The index of the line `match` names, or -1. In order: the same key; a
 * line that contains the name (or a name that contains the line); a line
 * that has every word of the name, in any order, plural-tolerant.
 */
export function findLine(
  lines: readonly { description: string }[],
  match: string,
): number {
  const want = lineKey(match);
  if (!want) return -1;
  const keys = lines.map((l) => lineKey(l.description));
  const exact = keys.indexOf(want);
  if (exact >= 0) return exact;
  if (want.length >= 3) {
    const contained = keys.findIndex((k) =>
      k.length >= 3 && (k.includes(want) || want.includes(k))
    );
    if (contained >= 0) return contained;
  }
  const ws = words(want);
  if (ws.length === 0) return -1;
  return keys.findIndex((k) => {
    const have = words(k);
    return ws.every((w) => have.includes(w));
  });
}

/**
 * Apply `changes` (reprice / reword the matched lines) and `remove` (drop
 * the matched lines) to `base`. A repriced line becomes one flat amount
 * (qty 1 × the new total); a reworded line loses its cached translations.
 * When any name matches nothing, NOTHING is applied — the caller tells the
 * user which name was unknown instead of guessing or appending.
 */
export function reviseLineItems<T extends RevisableLine>(
  base: readonly T[],
  changes: readonly LineChange[],
  remove: readonly string[],
): LineRevision<T> {
  const unmatched: string[] = [];
  const patched: T[] = base.map((l) => ({ ...l }));
  const dropped = new Set<number>();

  for (const c of changes) {
    const i = findLine(base, c.match);
    if (i < 0) {
      unmatched.push(c.match);
      continue;
    }
    const next: T = { ...patched[i] };
    const wording = (c.description ?? "").trim();
    if (wording && lineKey(wording) !== lineKey(next.description)) {
      next.description = wording;
      delete (next as RevisableLine).descriptionByLang;
    }
    if (typeof c.amountCents === "number" && Number.isFinite(c.amountCents)) {
      next.price = Math.trunc(c.amountCents);
      next.quantity = 1;
    }
    patched[i] = next;
  }
  for (const r of remove) {
    const i = findLine(base, r);
    if (i < 0) unmatched.push(r);
    else dropped.add(i);
  }

  if (unmatched.length > 0) {
    const asIs = [...base];
    return { lineItems: asIs, estimatedTotal: totalOf(asIs), unmatched };
  }
  const lineItems = patched.filter((_, i) => !dropped.has(i));
  return { lineItems, estimatedTotal: totalOf(lineItems), unmatched: [] };
}

// ---------------------------------------------------------------------------
// Reading a reprice out of plain words ("change plumbing fixtures to $1,300").
// The demo's model sent exactly that sentence to change_order as "Adjust
// plumbing fixtures to $1,300" (+$150), and "change order for Dana on Q-001:
// change plumbing fixtures to $1,300" never reached the model — the
// change-order parser appended "Change plumbing fixtures to" for +$1,300.
// ---------------------------------------------------------------------------

export interface LineReprice {
  /** The line as the user named it ("plumbing fixtures"). */
  match: string;
  /** Its NEW total, integer cents. */
  amountCents: number;
}

const MONEY_SRC = String
  .raw`\$\s?(?<whole>\d{1,3}(?:,\d{3})+|\d+)(?:\.(?<frac>\d{1,2}))?`;
/** Verbs that set a price. Never "change order" — that adds or credits. */
const SET_VERB_EN = String
  .raw`(?:change(?![\s-]*orders?\b)|adjust|update|set|make|reprice|re-price|raise|lower|increase|decrease|bump|reduce|drop|cut|price)`;
const SET_VERB_ES = String
  .raw`(?:cambiar|cambia|cambie|ajustar|ajusta|actualizar|actualiza|poner|pon|ponle|subir|sube|bajar|baja|dejar|deja)`;
const ADD_OR_CREDIT = String
  .raw`(?:add|adding|plus|also|remove|drop|credit|deduct|agregar|agrega|añadir|añade|quitar|quita)`;

const REPRICE_RES: RegExp[] = [
  // "change plumbing fixtures to $1,300", "price the tile at $4,000"
  new RegExp(
    String
      .raw`\b${SET_VERB_EN}\s+(?<line>[^$\n:;!?]+?)\s+(?:to|at)\s+(?:be\s+)?(?:only\s+)?${MONEY_SRC}`,
    "iu",
  ),
  // "make the deck stain $400"
  new RegExp(String.raw`\bmake\s+(?<line>[^$\n:;!?]+?)\s+${MONEY_SRC}`, "iu"),
  // "cambiar la plomería a $1,300"
  new RegExp(
    String
      .raw`(?:^|[\s¿¡])${SET_VERB_ES}\s+(?:el\s+precio\s+(?:de|del)\s+)?(?<line>[^$\n:;!?]+?)\s+(?:a|en)\s+(?:solo\s+)?${MONEY_SRC}`,
    "iu",
  ),
  // "plumbing fixtures should be $1,300", "the tile is now $4,000"
  new RegExp(
    String
      .raw`(?:^|[.!?;:]\s+)(?<line>[^$\n,.:;!?]+?)\s+(?:should\s+(?:be|cost)|is\s+now|now\s+(?:is|costs?)|costs?\s+now|needs\s+to\s+be|debe\s+(?:ser|costar)|ahora\s+cuesta|cuesta\s+ahora|queda\s+en)\s+(?:only\s+|solo\s+)?${MONEY_SRC}`,
    "iu",
  ),
  // the whole clause is "plumbing fixtures to $1,300" (a verb-led clause
  // is the patterns' above to read — or to refuse)
  new RegExp(
    String
      .raw`^\s*(?!(?:${ADD_OR_CREDIT}|${SET_VERB_EN}|${SET_VERB_ES})\b)(?<line>[^$\n:;!?]+?)\s+(?:to|→|->|=)\s+(?:only\s+)?${MONEY_SRC}\s*[.!]?\s*$`,
    "iu",
  ),
];

/** A name that starts like something NEW ("set up a fridge cleaning",
 *  "make a new line for …", "otra partida") is an addition, not a reprice. */
const NEW_THING_RE =
  /^(?:a|an|new|another|up|in|out|un|una|otro|otra|nuevo|nueva)\s/i;

/** Names that point at no one line ("change it to $500", "the total"). */
const NOT_A_LINE = new Set([
  "it",
  "that",
  "this",
  "them",
  "everything",
  "all",
  "total",
  "price",
  "quote",
  "job",
  "estimate",
  "eso",
  "esto",
  "todo",
  "precio",
  "cotizacion",
  "presupuesto",
  "trabajo",
]);

/** REQ-445 (demo-loop cycle 3, B2): how sure a price is — never part of a
 *  line's name ("make it around $18,000", "make the tile about $4,000"). */
const APPROX_TAIL =
  /(?:^|\s+)(?:around|about|roughly|approximately|approx\.?|like|more\s+like|closer\s+to|como|unos|alrededor\s+de)$/i;

/** "the price of the vanity" → "vanity"; "labor line" → "labor";
 *  "plumbing fixtures on Q-001" → "plumbing fixtures"; REQ-445: "that
 *  vanity" → "vanity", "it around" → "" (the job, not a line). */
function cleanLineName(raw: string): string {
  return raw.trim()
    .replace(/^(?:it|that|this|these|those)\s+/i, "")
    .replace(APPROX_TAIL, "")
    .replace(/^(?:the|a|an|la|el|los|las)\s+/i, "")
    .replace(
      /^(?:price|cost|precio)\s+(?:of|on|for|de|del)\s+(?:(?:the|la|el|los|las)\s+)?/i,
      "",
    )
    .replace(
      /\s+(?:on|in|of|for|from|en|de|del)\s+(?:(?:the|la|el)\s+)?(?:Q-\d+\b|(?:[\p{L}'’]+\s+)?(?:quote|job|estimate|cotizaci[oó]n|presupuesto|trabajo)\b).*$/iu,
      "",
    )
    .replace(/\s+(?:line(?:\s+item)?|item|partida|price|cost|precio)$/i, "")
    .replace(/^["“”'‘’]+|["“”'‘’]+$/g, "")
    .trim();
}

/**
 * "Change plumbing fixtures to $1,300" → { match: "plumbing fixtures",
 * amountCents: 130000 }. Undefined when the words do not set a named line's
 * price — adding or crediting work, "change it to $500", "the total", a
 * change-order phrase, a new material ("change the tile to porcelain, $300").
 */
export function parseLineReprice(text: string): LineReprice | undefined {
  const s = (text ?? "").trim();
  if (!s) return undefined;
  for (const re of REPRICE_RES) {
    const m = s.match(re);
    const g = m?.groups;
    if (!g?.line || !g.whole) continue;
    if (NEW_THING_RE.test(g.line.trim())) continue;
    const match = cleanLineName(g.line);
    if (!match || !/\p{L}/u.test(match) || match.length > 80) continue;
    if (NOT_A_LINE.has(lineKey(match))) continue;
    if (/\bQ-\d+\b|\bchange[\s-]*orders?\b/i.test(match)) continue;
    const frac = g.frac ? Number(g.frac.padEnd(2, "0")) : 0;
    return {
      match,
      amountCents: Number(g.whole.replace(/,/g, "")) * 100 + frac,
    };
  }
  return undefined;
}

/**
 * The model reached for change_order (which APPENDS a line) on what the user
 * asked as a reprice — the demo's "Adjust plumbing fixtures to $1,300"
 * (+$150). It is the reprice when its own description reads as one, or when
 * the user asked to reprice a line and the change order is about that line.
 */
export function changeOrderAsReprice(
  change: { description: string },
  userText: string,
): LineReprice | undefined {
  const own = parseLineReprice(change.description);
  if (own) return own;
  const asked = parseLineReprice(userText);
  if (!asked) return undefined;
  const sameLine =
    findLine([{ description: change.description }], asked.match) >= 0 ||
    findLine([{ description: asked.match }], change.description) >= 0;
  return sameLine ? asked : undefined;
}
