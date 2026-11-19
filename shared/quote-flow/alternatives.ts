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
import { moneyAmounts } from "./money-amounts.ts";

/** One alternative the contractor typed: its label as typed ("option A"),
 *  its words, and its price. */
export interface TypedAlternative {
  label: string;
  text: string;
  cents: number;
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
  const found = byLabel.length >= 2 ? byLabel : unlabelled(s);
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
): T[] | undefined {
  const [first, ...others] = alts;
  if (!first || others.length === 0 || lines.length === 0) return undefined;
  const total = sum(lines);
  const ofOther = (l: T) =>
    others.some((o) => names(l, o)) ||
    (!names(l, first) && l.amountCents !== first.cents &&
      others.some((o) => o.cents === l.amountCents));
  const carriesOthers = lines.some(ofOther) ||
    alts.some((a, i) =>
      alts.slice(i + 1).some((b) => total >= a.cents + b.cents)
    );
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
