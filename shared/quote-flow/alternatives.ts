/**
 * REQ-942 (LOOP-007 cycle 1, q1-1) — alternatives the contractor typed for
 * the customer to pick from are never added into one total.
 *
 * QA2 typed "two options: option A basic subway tile $9,800, option B large
 * format porcelain + niche + glass door $13,450". The model drafted both as
 * lines of one quote; it was saved at $23,250, the /q page, the email, the
 * deposit and INV-001 all read that sum, and signing bound the customer to
 * two mutually exclusive jobs. A quote holds one job's lines, so a message
 * that names alternatives drafts the FIRST option alone and says so.
 */
import { labelledAmounts, moneyAmounts } from "./money-amounts.ts";

/** One alternative the contractor typed: its label as typed ("option A"),
 *  its words, and its price. */
export interface TypedAlternative {
  label: string;
  text: string;
  cents: number;
  /** REQ-1096: what this option adds on top of the first one, when it is
   *  the first option plus an add-on ("option 2: also … $325", "better =
   *  deck + gutters") — a draft line at exactly this price is the add-on. */
  extraCents?: number;
}

const MARKER =
  /\b(option|opci[oó]n|alternative|alternativa|choice)\s+(?:#\s*)?([a-d]|[1-4]|one|two|three|uno|dos|tres)\b(?![a-z0-9'’])/giu;
/** "two options", "2 choices", "dos opciones", "options:" — a choice is
 *  being offered even without labels. */
const CUE =
  /\b(?:two|three|2|3|dos|tres)\s+(?:options|choices|alternatives|opciones|alternativas)\b|\b(?:options|opciones)\s*:/iu;
/** "… or …" / "… o …" / "… vs …" between two priced choices. */
const OR = /\s(?:or|o|vs\.?|versus|u)\s/iu;

/** Where the sentence holding `at` ends (".", "!", "?", newline), or the end. */
function sentenceEnd(s: string, at: number): number {
  const re = /[.!?](?=\s|$)|\n/g;
  re.lastIndex = at;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    // "$9.800" / "1.5" are not a sentence end
    if (/\d/.test(s[m.index - 1] ?? "") && /\d/.test(s[m.index + 1] ?? "")) {
      continue;
    }
    return m.index;
  }
  return s.length;
}

const clean = (s: string) =>
  s.replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, "").replace(/\s+/g, " ");

function labelled(s: string): TypedAlternative[] {
  const marks = [...s.matchAll(MARKER)];
  const out: TypedAlternative[] = [];
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    const start = m.index!;
    const next = marks[i + 1]?.index ?? s.length;
    const end = Math.min(next, sentenceEnd(s, start + m[0].length));
    const seg = s.slice(start, end);
    const price = moneyAmounts(seg)[0];
    if (!price || price.cents <= 0) continue;
    const label = clean(m[0]);
    if (out.some((o) => o.label.toLowerCase() === label.toLowerCase())) {
      continue;
    }
    out.push({
      label,
      text: clean(seg.slice(m[0].length, price.end)),
      cents: price.cents,
    });
  }
  return out;
}

function unlabelled(s: string): TypedAlternative[] {
  const cue = CUE.exec(s);
  if (!cue) return [];
  const from = cue.index + cue[0].length;
  const sentence = s.slice(from, sentenceEnd(s, from));
  const parts = sentence.split(/[;,]?\s*(?:\s(?:or|o|vs\.?|versus|u)\s)/iu);
  if (parts.length < 2 || !OR.test(sentence)) return [];
  const out: TypedAlternative[] = [];
  for (const part of parts) {
    const amounts = moneyAmounts(part);
    if (amounts.length !== 1) return [];
    out.push({
      label: clean(part.slice(0, amounts[0].start)) || clean(part),
      text: clean(part.slice(0, amounts[0].end)),
      cents: amounts[0].cents,
    });
  }
  return out;
}

/** REQ-1096: words that say an option is ADDED to what came before it —
 *  "option 2: also pressure wash driveway $325". */
const ADD_ON =
  /(?<![\p{L}])(?:also|add|adds|added|adding|plus|extra|additional|tambi[eé]n|agrega\w*|a[nñ]ad\w*|m[aá]s|adicional|extra)(?![\p{L}])|\+/iu;

/** The first option's tag in the style the second was typed in: "2" → "1",
 *  "B" → "A", "two" → "one", "dos" → "uno". */
function firstTag(tag: string): string | undefined {
  const t = tag.toLowerCase();
  const map: Record<string, string> = {
    "2": "1",
    b: "a",
    two: "one",
    dos: "uno",
  };
  const out = map[t];
  if (!out) return undefined;
  return tag === tag.toUpperCase() && /[a-z]/i.test(tag)
    ? out.toUpperCase()
    : out;
}

/** The job amounts typed in `s` — "$4,850", "labor 1400" — or undefined
 *  when one is a rate or negative (a per-unit price can't be summed). */
function jobAmounts(s: string) {
  const all = labelledAmounts(s).filter((a) => a.cents > 0);
  if (all.some((a) => a.rate || a.negative || a.per)) return undefined;
  return all;
}

/**
 * REQ-1096 (LOOP-007 q3-21): ONE priced second option after priced lines —
 * "exterior $4,850, fence $1,275.50. option 2: also pressure wash driveway
 * $325". Option 1 is the lines typed before it; option 2 is those plus the
 * add-on when its words say so ("also", "add", "plus", "+"), else its own
 * price.
 */
function loneSecond(s: string): TypedAlternative[] {
  const marks = [...s.matchAll(MARKER)];
  if (marks.length !== 1) return [];
  const m = marks[0];
  const tag = firstTag(m[2]);
  if (!tag) return [];
  const start = m.index!;
  const seg = s.slice(start, sentenceEnd(s, start + m[0].length));
  const own = jobAmounts(seg);
  if (!own || own.length !== 1) return [];
  const before = jobAmounts(s.slice(0, start));
  if (!before || before.length === 0) return [];
  const totals = before.filter((a) => a.label === "total");
  const base = totals.length === 1
    ? totals[0].cents
    : before.filter((a) => a.label !== "total")
      .reduce((n, a) => n + a.cents, 0);
  const typed = seg.slice(m[0].length, own[0].end);
  const addOn = ADD_ON.test(typed.slice(0, own[0].start - m[0].length));
  const second = addOn ? base + own[0].cents : own[0].cents;
  if (base <= 0 || second === base) return [];
  const from = s.lastIndexOf(".", before[0].start) + 1;
  const firstText = clean(
    s.slice(from > 0 ? from : 0, before[before.length - 1].end),
  );
  return [
    { label: `${m[1]} ${tag}`.toLowerCase(), text: firstText, cents: base },
    {
      label: clean(m[0]).toLowerCase(),
      text: clean(typed),
      cents: second,
      ...(addOn ? { extraCents: own[0].cents } : {}),
    },
  ];
}

/** REQ-1096: a tier the contractor defines — "good = deck only", "better:
 *  deck + gutters", "bueno = …", "mejor: …", "el mejor = …". The "=" / ":"
 *  is required: "in good shape, better to stain it now" is plain English. */
const TIER =
  /(?<![\p{L}])(good|better|best|bueno|buena|el\s+mejor|la\s+mejor|mejor)\s*(?:=|:|\s[-–—]\s)/giu;
const TIER_LABEL: Record<string, string> = {
  good: "Good",
  better: "Better",
  best: "Best",
  bueno: "Bueno",
  buena: "Buena",
  mejor: "Mejor",
  "el mejor": "El mejor",
  "la mejor": "La mejor",
};
/** Words of a tier's definition that name no line. */
const TIER_FILLER = new Set(
  ("only just also plus everything all todo solo solamente nada mas más " +
    "good better best bueno buena mejor").split(" "),
);

/** A word and its plural read as one ("gutters" = "gutter"). */
const stem = (w: string) =>
  w.length > 3 && /[^s]s$/.test(w) ? w.slice(0, -1) : w;

function tierWords(s: string): Set<string> {
  return new Set(
    [...words(s)].filter((w) => !TIER_FILLER.has(w)).map(stem),
  );
}

/** A bare amount typed as a cost in a tiered message — "materials around
 *  600", "clean them 175" — at a clause's end, at least $50, never a size
 *  ("14x20"), a count ("6 boards", "2 coats"), a percentage or a zip. */
const BARE_COST =
  /(?<![\p{L}\d$.,x×\-/])(\d{1,3}(?:,\d{3})+|\d{2,4})(?:\.(\d{1,2}))?(?![\d%x×]|[.,]\d)(?=\s*(?:$|[.,;:!?)]|(?:and|plus|y|labou?r|materials?|mano|materiales)(?![\p{L}])))/giu;

function tierAmounts(s: string) {
  const found = jobAmounts(s);
  if (!found) return undefined;
  const out: { cents: number; start: number; end: number }[] = [...found];
  for (const m of s.matchAll(BARE_COST)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (out.some((a) => start < a.end && end > a.start)) continue;
    const cents = Number(m[1].replace(/,/g, "")) * 100 +
      Number((m[2] ?? "").padEnd(2, "0") || 0);
    if (cents < 5_000) continue;
    out.push({ cents, start, end });
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * REQ-1096 (LOOP-007 q3-21): good/better/best tiers — "give her a
 * good/better: good = deck only, better = deck + gutters". A tier with its
 * own price keeps it; a tier that names lines is priced from the amounts
 * typed before the tiers: an amount whose words name a tier's line ("the
 * gutters - clean them 175") belongs to the tiers naming it, an amount
 * naming none ("materials around 600 labor 1400") to every tier.
 */
function tiered(s: string): TypedAlternative[] {
  const marks = [...s.matchAll(TIER)];
  const defs: { key: string; start: number; seg: string }[] = [];
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    const from = m.index! + m[0].length;
    const end = Math.min(
      marks[i + 1]?.index ?? s.length,
      sentenceEnd(s, from),
    );
    const seg = s.slice(from, end);
    if (!clean(seg)) continue; // "good/better:" introduces the tiers
    const key = m[1].toLowerCase().replace(/\s+/g, " ");
    if (defs.some((d) => d.key === key)) return [];
    defs.push({ key, start: m.index!, seg });
  }
  if (defs.length < 2) return [];
  const intro = s.lastIndexOf(".", defs[0].start);
  const head = s.slice(0, intro > 0 ? intro + 1 : defs[0].start);
  const amounts = tierAmounts(head) ?? [];
  const tiers = defs.map((d) => ({ ...d, w: tierWords(d.seg) }));
  const all = new Set(tiers.flatMap((t) => [...t.w]));
  // the tier words each amount's own words name: before it (back to the
  // previous amount or the sentence), else after it
  const named = amounts.map((a, i) => {
    const prev = amounts[i - 1];
    const sentence = head.lastIndexOf(".", a.start - 1) + 1;
    const from = Math.max(prev?.end ?? 0, sentence);
    const hit = (t: string) =>
      new Set([...tierWords(t)].filter((w) => all.has(w)));
    const b = hit(head.slice(from, a.start));
    if (b.size > 0) return b;
    const next = amounts[i + 1]?.start ?? head.length;
    return hit(head.slice(a.end, Math.min(next, sentenceEnd(head, a.end))));
  });
  const out: TypedAlternative[] = [];
  for (const t of tiers) {
    const own = jobAmounts(t.seg);
    if (own === undefined) return [];
    const priced = own.length === 1;
    const cents = priced ? own[0].cents : amounts.reduce(
      (n, a, i) =>
        named[i].size === 0 || [...named[i]].some((w) => t.w.has(w))
          ? n + a.cents
          : n,
      0,
    );
    if (cents <= 0 || (own.length > 1)) return [];
    out.push({
      label: TIER_LABEL[t.key] ?? clean(t.key),
      text: clean(priced ? t.seg.slice(0, own[0].end) : t.seg),
      cents,
    });
  }
  if (new Set(out.map((o) => o.cents)).size !== out.length) return [];
  const [first] = out;
  return out.map((o, i) =>
    i > 0 && o.cents > first.cents
      ? { ...o, extraCents: o.cents - first.cents }
      : o
  );
}

/**
 * The alternatives a message offers the customer — "option A … $9,800,
 * option B … $13,450", "opción A … / opción B …", "two options: subway $9,800
 * or porcelain $13,450" — each with its own price; undefined unless at least
 * two priced alternatives are named.
 */
export function typedAlternatives(
  text: string,
): TypedAlternative[] | undefined {
  const s = (text ?? "").normalize("NFC");
  const byLabel = labelled(s);
  let found = byLabel.length >= 2 ? byLabel : unlabelled(s);
  // REQ-1096 (LOOP-007 q3-21): "… option 2: also … $325" after priced lines,
  // and good/better/best tiers
  if (found.length < 2) found = loneSecond(s);
  if (found.length < 2) found = tiered(s);
  return found.length >= 2 ? found : undefined;
}

interface Line {
  description: string;
  amountCents: number;
}

const sum = (ls: readonly Line[]) => ls.reduce((n, l) => n + l.amountCents, 0);

/** Whether a line belongs to `alt`: its label in the description
 *  ("Option B: …"). */
function names(line: Line, alt: TypedAlternative): boolean {
  const [word, tag] = alt.label.split(/\s+/);
  if (!word || !tag) return false;
  const w = word.toLowerCase().startsWith("opci") ? "opci[oó]n" : word;
  return new RegExp(`\\b${w}\\s+${tag}\\b(?![a-z0-9])`, "iu").test(
    line.description,
  );
}

/** Words that say nothing about which option a line is. */
const FILLER = new Set(
  ("a an and the of for to in on at by with w or vs versus plus new old " +
    "option options choice alternative opcion opción alternativa y o u con " +
    "de del la el los las un una para en por sin").split(" "),
);

/** The content words of a description or an option's typed words. */
function words(s: string): Set<string> {
  return new Set(
    (s ?? "").toLowerCase().normalize("NFC").replace(/\$?[\d.,]+/g, " ")
      .split(/[^\p{L}]+/u)
      .filter((w) => w.length >= 3 && !FILLER.has(w)),
  );
}

/**
 * REQ-1019 (LOOP-007 q2-2): whether a line describes `alt` by its own words
 * ("Upgrade: tile niche and glass door" for "upgrade with niche + glass
 * door") — words of that option no other option shares, more of them than
 * of any other option's.
 */
function describes(
  line: Line,
  alt: TypedAlternative,
  alts: readonly TypedAlternative[],
): boolean {
  const own = (a: TypedAlternative) => {
    const mine = words(`${a.label} ${a.text}`);
    for (const b of alts) {
      if (b === a) continue;
      for (const w of words(`${b.label} ${b.text}`)) mine.delete(w);
    }
    return mine;
  };
  const said = words(line.description);
  const hits = (a: TypedAlternative) =>
    [...own(a)].filter((w) => said.has(w)).length;
  const mine = own(alt);
  const n = hits(alt);
  if (n < Math.min(2, mine.size) || n === 0) return false;
  return alts.every((b) => b === alt || hits(b) < n);
}

/**
 * A draft's lines narrowed to the FIRST alternative, when they carry more
 * than one of them (a line per option, or a total that adds options up).
 * Lines of the other options go; shared lines stay, and the result adds up
 * to the first option's price. Undefined when the draft already holds one
 * option only.
 */
export function firstAlternativeLines<T extends Line>(
  lines: readonly T[],
  alts: readonly TypedAlternative[],
  opts: { carried?: boolean } = {},
): T[] | undefined {
  const [first, ...others] = alts;
  if (!first || others.length === 0 || lines.length === 0) return undefined;
  const total = sum(lines);
  // REQ-1019: options typed in an EARLIER message — a draft that already is
  // one option (either one) is the contractor's pick, not a mix.
  if (opts.carried && alts.some((a) => a.cents === total)) return undefined;
  const ofFirst = (l: T) => names(l, first) || describes(l, first, alts);
  const ofOther = (l: T) =>
    others.some((o) => names(l, o) || describes(l, o, alts)) ||
    (!ofFirst(l) && l.amountCents !== first.cents &&
      others.some((o) =>
        o.cents === l.amountCents || o.extraCents === l.amountCents
      ));
  // REQ-1019 (LOOP-007 q2-2): one option's price on two lines ($8,400 on the
  // base work AND on the upgrade) bills it twice — the draft is not one
  // option when its total is neither option's price.
  const atOptionPrice = lines.filter((l) =>
    l.amountCents > 0 && alts.some((a) => a.cents === l.amountCents)
  );
  const repeated = atOptionPrice.length > 1 &&
    !alts.some((a) => a.cents === total);
  const carriesOthers = lines.some(ofOther) || repeated ||
    (!opts.carried &&
      alts.some((a, i) =>
        alts.slice(i + 1).some((b) => total >= a.cents + b.cents)
      ));
  if (!carriesOthers) return undefined;
  const kept = lines.filter((l) => !ofOther(l));
  if (kept.length > 0 && sum(kept) === first.cents) {
    return kept.map((l) => ({ ...l }));
  }
  // one line holding the first option (its words as typed), or the kept
  // lines with the first option's price on the largest of them
  const one = kept.find((l) => l.amountCents === first.cents);
  if (one) return [{ ...one }];
  if (kept.length === 1 || kept.length === 0) {
    const base = kept[0] ?? lines[0];
    return [{
      ...base,
      description: kept[0]?.description || first.text || first.label,
      amountCents: first.cents,
    }];
  }
  const rest = kept.slice(1);
  const restCents = sum(rest);
  if (restCents > 0 && restCents < first.cents) {
    return [{ ...kept[0], amountCents: first.cents - restCents }, ...rest]
      .map((l) => ({ ...l }));
  }
  return [{
    ...kept[0],
    description: first.text || kept[0].description,
    amountCents: first.cents,
  }];
}
