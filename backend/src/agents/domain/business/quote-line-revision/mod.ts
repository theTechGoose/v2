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

/** REQ-1084 (LOOP-007 q3-18): a NEW line added in the same revision. */
export interface LineAddition {
  description: string;
  /** The new line's total in integer cents (qty 1 × this). */
  amountCents: number;
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
 *
 * REQ-1084 (LOOP-007 q3-18): `add` appends NEW lines (qty 1 × the amount,
 * after the reprices and removals) — one Version can add, remove and
 * reprice together ("agregar pintar el pasillo por $450 y quitar el
 * drywall. hazme una nueva versión").
 */
export function reviseLineItems<T extends RevisableLine>(
  base: readonly T[],
  changes: readonly LineChange[],
  remove: readonly string[],
  add: readonly LineAddition[] = [],
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
  for (const a of add) {
    const description = (a.description ?? "").trim();
    if (!description || !Number.isFinite(a.amountCents)) continue;
    lineItems.push({
      description,
      quantity: 1,
      unit: "ea",
      price: Math.trunc(a.amountCents),
    } as T);
  }
  return { lineItems, estimatedTotal: totalOf(lineItems), unmatched: [] };
}

/** REQ-1084 (LOOP-007 q3-18): words that ask for a NEW line ("add a new
 *  line: hallway painting $450", "agregar pintar el pasillo por $450",
 *  "nueva partida"), read on the accent-free `lineKey` of the text. */
const ADD_LINE_RE =
  /\b(?:add|adding|agregar|agrega|agregue|agreguen|agregale|agregales|anadir|anade|anada|anadan|anadele|new (?:line|item)|nueva (?:partida|linea)|otra partida)\b/;

/** REQ-1084: the user's words ask for a new line to be added. */
export function saysAddLine(text: string): boolean {
  return ADD_LINE_RE.test(lineKey(text));
}

/**
 * REQ-1084 (LOOP-007 q3-18): the model that still puts a NEW line in
 * `lines[]` ({ match: "Pintura interior (pasillo)", amountCents: 45000 })
 * next to a removal. An entry is read as an addition only when it names no
 * line on the quote, carries a price the user typed, and the user's words
 * ask to add — a misspelled reprice ("change plumbng to $1,300") still
 * matches nothing and is asked about.
 */
export function splitAdditions(
  base: readonly { description: string }[],
  changes: readonly LineChange[],
  userText: string,
  typedCents: readonly number[],
): { lines: LineChange[]; add: LineAddition[] } {
  if (!saysAddLine(userText)) return { lines: [...changes], add: [] };
  const lines: LineChange[] = [];
  const add: LineAddition[] = [];
  for (const c of changes) {
    const cents = typeof c.amountCents === "number" &&
        Number.isFinite(c.amountCents)
      ? Math.trunc(c.amountCents)
      : undefined;
    if (
      cents !== undefined && cents > 0 && typedCents.includes(cents) &&
      findLine(base, c.match) < 0
    ) {
      add.push({
        description: (c.description ?? "").trim() || c.match.trim(),
        amountCents: cents,
      });
    } else lines.push(c);
  }
  return { lines, add };
}

/**
 * REQ-1027 (LOOP-007 cycle 2, q2-4): land a revision on the job's stated NEW
 * total. "haz una version 2 de Q-002 sin la cerca, solo la pintura, total
 * 5,550": the model, with no total field, put 555000 on "Pintura exterior"
 * and removed the fence; applied as sent, Materiales $1,350 stayed and
 * Version 2 was $6,900.
 *
 *   1. A line repriced to exactly the target is the model's slip (the total
 *      put on a line): that line keeps its price (a rewording stays).
 *   2. Still off: the one repriced line — or, with none, the largest line
 *      left — takes up the difference (target − every other line).
 *
 * Undefined when it cannot be landed: a name matches nothing, more than one
 * line was repriced, the repriced line's price is one the user typed
 * (`typedCents` — his words are never overridden), or the absorbing line
 * would be ≤ 0. The caller then writes nothing and asks.
 */
export function settleToTotal<T extends RevisableLine>(
  base: readonly T[],
  changes: readonly LineChange[],
  remove: readonly string[],
  targetCents: number,
  typedCents: readonly number[] = [],
  add: readonly LineAddition[] = [],
): LineRevision<T> | undefined {
  if (!Number.isFinite(targetCents) || targetCents <= 0) return undefined;
  const fixed: LineChange[] = [];
  for (const c of changes) {
    if (c.amountCents === targetCents) {
      if ((c.description ?? "").trim()) {
        fixed.push({ match: c.match, description: c.description });
      }
    } else fixed.push({ ...c });
  }
  const rev = reviseLineItems(base, fixed, remove, add);
  if (rev.unmatched.length > 0) return undefined;
  if (rev.estimatedTotal === targetCents) return rev;

  const repriced = fixed.filter((c) =>
    typeof c.amountCents === "number" && Number.isFinite(c.amountCents)
  );
  if (repriced.length > 1) return undefined;
  const dropped = new Set(remove.map((r) => findLine(base, r)));
  const lineTotal = (l: RevisableLine) => (l.price ?? 0) * (l.quantity ?? 1);
  let at: number;
  let current: number;
  if (repriced.length === 1) {
    if (typedCents.includes(Math.trunc(repriced[0].amountCents!))) {
      return undefined;
    }
    at = findLine(base, repriced[0].match);
    current = Math.trunc(repriced[0].amountCents!);
  } else {
    at = -1;
    base.forEach((l, i) => {
      if (dropped.has(i)) return;
      if (at < 0 || lineTotal(l) > lineTotal(base[at])) at = i;
    });
    if (at < 0) return undefined;
    current = lineTotal(base[at]);
  }
  if (at < 0 || dropped.has(at)) return undefined;
  const amountCents = targetCents - (rev.estimatedTotal - current);
  if (amountCents <= 0) return undefined;
  const settled = repriced.length === 1
    ? fixed.map((c) => c === repriced[0] ? { ...c, amountCents } : c)
    : [...fixed, { match: base[at].description, amountCents }];
  const out = reviseLineItems(base, settled, remove, add);
  return out.unmatched.length === 0 && out.estimatedTotal === targetCents
    ? out
    : undefined;
}

// ---------------------------------------------------------------------------
// REQ-1024 (LOOP-007 q2-6): a line taken off takes its job-details bullet
// with it. "quita la reparación de la cerca" removed the fence LINE from a
// sent quote, but its bullet "También incluye la reparación de la cerca …"
// stayed in the job details and Version 2 told the customer the fence repair
// was still included.
// ---------------------------------------------------------------------------

export interface JobDetailsText {
  description?: string;
  descriptionByLang?: Record<string, string>;
}

export interface JobDetailsDrop extends JobDetailsText {
  /** Some bullet was dropped (or a stale translation cleared). */
  changed: boolean;
  /** Names whose bullet also names a line that stays — left for the owner. */
  unsure: string[];
}

/** The indexes (into `text.split("\n")`) of the lines that are bullets. */
function bulletRows(text: string): number[] {
  return text.split("\n").flatMap((l, i) => l.trim() ? [i] : []);
}

function bulletText(row: string): string {
  return row.replace(/^\s*(?:[-•*·]|\d+[.)])\s*/u, "").trim();
}

function names(bullet: string, name: string): boolean {
  return findLine([{ description: bulletText(bullet) }], name) >= 0;
}

/**
 * The job details with every bullet that names a removed line dropped, in
 * the base text and in every language. `removed` holds, per removed line,
 * the names it goes by (what the user said, its description, its
 * translations); `kept` are the lines that stay. A bullet that also names a
 * kept line is not dropped — its name goes in `unsure`. A translation whose
 * bullets line up one-to-one with the base text loses the same rows; one
 * that does not and names nothing removed by itself is cleared (stale — the
 * next translate run refills it from the new base text).
 */
export function dropRemovedLineBullets(
  details: JobDetailsText,
  removed: readonly { names: readonly string[] }[],
  kept: readonly RevisableLine[],
): JobDetailsDrop {
  const unsure: string[] = [];
  const keptNames = kept.flatMap((l) => [
    l.description,
    ...Object.values(l.descriptionByLang ?? {}),
  ]).filter((n) => lineKey(n));
  /** The rows of `text` to drop — by the removed lines' names. */
  const rowsToDrop = (text: string, report: boolean): Set<number> => {
    const rows = text.split("\n");
    const out = new Set<number>();
    for (const i of bulletRows(text)) {
      const hit = removed.find((r) => r.names.some((n) => names(rows[i], n)));
      if (!hit) continue;
      if (keptNames.some((n) => names(rows[i], n))) {
        if (report) unsure.push(hit.names[0]);
        continue;
      }
      out.add(i);
    }
    return out;
  };
  const without = (text: string, drop: Set<number>) =>
    text.split("\n").filter((_, i) => !drop.has(i)).join("\n").trim();

  const base = details.description;
  const baseDrop = typeof base === "string"
    ? rowsToDrop(base, true)
    : new Set<number>();
  const baseBullets = typeof base === "string" ? bulletRows(base) : [];
  /** The base text's dropped rows, as bullet positions (0th bullet, …). */
  const droppedBullets = new Set(
    baseBullets.flatMap((row, k) => baseDrop.has(row) ? [k] : []),
  );
  let changed = baseDrop.size > 0;
  const out: JobDetailsDrop = { changed, unsure };
  if (typeof base === "string") out.description = without(base, baseDrop);

  if (details.descriptionByLang) {
    const byLang: Record<string, string> = {};
    for (const [lang, text] of Object.entries(details.descriptionByLang)) {
      if (typeof text !== "string") continue;
      if (typeof base === "string" && text.trim() === base.trim()) {
        byLang[lang] = out.description!;
        continue;
      }
      const rows = bulletRows(text);
      if (typeof base === "string" && rows.length === baseBullets.length) {
        const drop = new Set(
          rows.flatMap((row, k) => droppedBullets.has(k) ? [row] : []),
        );
        byLang[lang] = without(text, drop);
        continue;
      }
      const own = rowsToDrop(text, typeof base !== "string");
      if (own.size > 0) {
        byLang[lang] = without(text, own);
        changed = true;
        continue;
      }
      if (droppedBullets.size > 0) {
        changed = true; // stale: still describes what the base text dropped
        continue;
      }
      byLang[lang] = text;
    }
    out.descriptionByLang = byLang;
  }
  out.changed = changed;
  out.unsure = [...new Set(unsure)];
  return out;
}

// ---------------------------------------------------------------------------
// REQ-1095 (LOOP-007 q3-20): a line taken off takes its name out of the
// quote's title and summary too. Q-002 "Pintura interior y drywall" lost its
// drywall line, but Version 2's email and text still read "… Versión 2 —
// Pintura interior y drywall".
// ---------------------------------------------------------------------------

export interface HeadingText {
  jobName?: string;
  jobNameByLang?: Record<string, string>;
  summary?: string;
  summaryByLang?: Record<string, string>;
}

export interface HeadingDrop extends HeadingText {
  /** Some heading (or a translation of one) changed. */
  changed: boolean;
  /** Names a heading still mentions beside a line that stays — left for the owner. */
  unsure: string[];
}

/** What joins a title's parts: "A, B and C", "A y B", "A & B", "A + B". */
const HEADING_JOIN_RE =
  /(\s*,\s*(?:(?:and|y|e)\s+)?|\s+(?:and|y|e|plus)\s+|\s*[&+]\s*)/iu;
/** What sets the customer off a summary: "… — Jose Ramirez". */
const HEADING_TAIL_RE = /(\s+[—–-]\s+.*)$/u;

function significant(text: string): string[] {
  return words(lineKey(text)).filter((w) => w.length >= 3);
}

/**
 * One heading with every part that names only a removed line dropped:
 * "Pintura interior y drywall" minus "Reparación de drywall en la cocina" →
 * "Pintura interior". A part that names a removed line AND a line that stays
 * is left (its name goes to `unsure`), and so is a heading every part of
 * which would go — that title is not for code to rewrite.
 */
function retitleOne(
  text: string,
  removed: readonly { first: string; words: Set<string> }[],
  keptWords: Set<string>,
  unsure: string[],
): string {
  const tail = text.match(HEADING_TAIL_RE);
  const head = tail ? text.slice(0, tail.index) : text;
  const tokens = head.split(HEADING_JOIN_RE);
  // tokens: part, joiner, part, joiner, part …
  const parts = tokens.filter((_, i) => i % 2 === 0);
  const drop = new Set<number>();
  parts.forEach((part, k) => {
    const ws = significant(part);
    const hit = removed.find((r) => ws.some((w) => r.words.has(w)));
    if (!hit) return;
    if (ws.some((w) => keptWords.has(w))) {
      unsure.push(hit.first);
      return;
    }
    drop.add(k);
  });
  if (drop.size === 0) return text;
  if (drop.size === parts.length) {
    for (const k of drop) {
      const ws = significant(parts[k]);
      const hit = removed.find((r) => ws.some((w) => r.words.has(w)));
      if (hit) unsure.push(hit.first);
    }
    return text;
  }
  // "A, B and C" keeps its shape: the first joiner between the parts that
  // stay, the last one ("and") before the final part.
  const keptParts = parts.filter((_, k) => !drop.has(k));
  const firstJoin = tokens[1] ?? ", ";
  const lastJoin = tokens[tokens.length - 2] ?? firstJoin;
  const joined = keptParts.map((part, k) =>
    k === 0 ? part : (k === keptParts.length - 1 ? lastJoin : firstJoin) + part
  ).join("");
  return joined.trim() + (tail ? tail[1] : "");
}

/**
 * The job name and summary, every language, without the parts that name a
 * removed line. `removed` holds, per removed line, the names it goes by;
 * `kept` are the lines that stay. A translation the base text changed in but
 * that names nothing removed by itself is cleared (stale — the next
 * translate run refills it from the new base text).
 */
export function retitleAfterRemoval(
  heading: HeadingText,
  removed: readonly { names: readonly string[] }[],
  kept: readonly RevisableLine[],
): HeadingDrop {
  const unsure: string[] = [];
  const keptWords = new Set(
    kept.flatMap((l) => [
      l.description,
      ...Object.values(l.descriptionByLang ?? {}),
    ]).flatMap(significant),
  );
  const gone = removed.map((r) => ({
    first: r.names[0] ?? "",
    words: new Set(
      r.names.flatMap(significant).filter((w) => !keptWords.has(w)),
    ),
  })).filter((r) => r.words.size > 0);
  const out: HeadingDrop = { changed: false, unsure };
  if (gone.length === 0) return out;

  const field = (
    base: string | undefined,
    byLang: Record<string, string> | undefined,
    set: (base: string | undefined, byLang: Record<string, string>) => void,
  ) => {
    let changed = false;
    let next = base;
    if (typeof base === "string") {
      next = retitleOne(base, gone, keptWords, unsure);
      changed = next !== base;
    }
    const langs: Record<string, string> = {};
    let langsChanged = false;
    for (const [lang, text] of Object.entries(byLang ?? {})) {
      if (typeof text !== "string") continue;
      if (typeof base === "string" && text.trim() === base.trim()) {
        langs[lang] = next!;
        langsChanged ||= next !== base;
        continue;
      }
      const own = retitleOne(text, gone, keptWords, unsure);
      if (own !== text) {
        langs[lang] = own;
        langsChanged = true;
        continue;
      }
      if (changed) {
        langsChanged = true; // stale: still the old heading's translation
        continue;
      }
      langs[lang] = text;
    }
    if (changed || langsChanged) {
      out.changed = true;
      set(next, langs);
    }
  };
  field(heading.jobName, heading.jobNameByLang, (b, l) => {
    if (b !== undefined) out.jobName = b;
    if (heading.jobNameByLang) out.jobNameByLang = l;
  });
  field(heading.summary, heading.summaryByLang, (b, l) => {
    if (b !== undefined) out.summary = b;
    if (heading.summaryByLang) out.summaryByLang = l;
  });
  out.unsure = [...new Set(unsure)];
  return out;
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
  // REQ-583 (demo-loop cycle 4, M2): an invoice is never a line on the quote
  "invoice",
  "factura",
  "bill",
]);

/** REQ-583 (demo-loop cycle 4, M2): pair 6's "Make the invoice for $450
 *  please." was read as a reprice of a line called "invoice for" — any
 *  invoice / bill / factura ("the deposit invoice", "la factura final") is
 *  billing, never a line. */
const INVOICE_WORD_RE = /\b(?:invoices?|bills?|facturas?)\b/i;

/** REQ-445 (demo-loop cycle 3, B2): how sure a price is — never part of a
 *  line's name ("make it around $18,000", "make the tile about $4,000"). */
const APPROX_TAIL =
  /(?:^|\s+)(?:around|about|roughly|approximately|approx\.?|like|more\s+like|closer\s+to|como|unos|alrededor\s+de)$/i;

/** "the price of the vanity" → "vanity"; "labor line" → "labor";
 *  "plumbing fixtures on Q-001" → "plumbing fixtures"; REQ-445: "that
 *  vanity" → "vanity", "it around" → "" (the job, not a line). */
function cleanLineName(raw: string): string {
  return raw.trim()
    // REQ-583: "make the cabinets for $400" — "for" belongs to the price
    .replace(/\s+(?:for|para|por)$/i, "")
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
    if (INVOICE_WORD_RE.test(match)) continue; // REQ-583
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
