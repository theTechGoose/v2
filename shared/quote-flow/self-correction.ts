/**
 * REQ-653 (demo-loop cycle 5, M7) — what the contractor typed, read the way
 * they meant it.
 *
 *   dropSelfCorrections — "LVP no wait porcelain tile 12x24" is porcelain
 *                         tile; the corrected-away word never reaches the
 *                         model or the typed yardstick (pair 7: every option
 *                         read "Install LVP and porcelain tile").
 *   mentionsSameAddress / sameAddressFor — "same address" is the customer's
 *                         last job address, else the one on their record
 *                         (pair 5: Q-002 had no job address).
 *   malformedEmailIn    — "email notanemail" is an e-mail the composer could
 *                         not use; the reply says it was skipped (pair 10).
 *
 * Dependency-light: imported by the backend (#quote-flow/) and the Jest unit
 * suite.
 */
import { extractEmail } from "./quote-facts.ts";

/** Cues that take back what came just before them. "actually" on its own is
 *  left to the model (the prompt rule): "the job is actually bigger" is not a
 *  correction. */
const CUE = new RegExp(
  String
    .raw`(^|[\s,;(])(no[\s,]+wait|wait[\s,]+no|no[\s,]+actually|actually[\s,]+no|I\s+meant?|scratch\s+that|make\s+that|no[\s,]+espera|espera[\s,]+no|mejor\s+dicho|quiero\s+decir)(?=[\s,;:.!?—–-]|$)`,
  "iu",
);

/** Where a clause starts or ends: a comma, a semicolon, a sentence end, a
 *  colon (REQ-763: "Quote for Mark Henderson: install LVP no wait …"), a
 *  dash or a line break. */
const DELIM = /[,;.!?\n]|:\s|\s[—–-]\s/u;

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);

/** REQ-763 (demo-loop cycle 5v2, M7): the clause's action word — never what
 *  a correction takes back ("install LVP no wait porcelain" is "install
 *  porcelain", not "porcelain"). */
const ACTION_WORD =
  /^(?:install|reinstall|replace|put|lay|add|paint|build|remove|fix|repair|swap|redo|do|use|need|want|supply|refinish|instal(?:ar|a|amos)|poner|pon|cambiar|cambia|colocar|coloca|pintar|pinta|quitar|reparar|hacer|usar|agregar|necesito|quiero)$/iu;

/** A size that rides along with the correction ("12x24", "30x60") — it
 *  describes the new word, it replaces nothing. */
const DIMENSION = /^\d+(?:[.,]\d+)?["']?\s*[x×]\s*\d+/iu;

/** A typed quantity and its unit ("200 sqft", "3"): kept unless the
 *  correction is itself a quantity ("3 windows make that 4 windows"). */
const HAS_DIGIT = /\d/u;

/**
 * How many of the clause's last words the correction takes back: one per
 * word of the correction (sizes not counted), never the clause's action word
 * or anything before it, nor a typed quantity unless the correction starts
 * with one.
 */
function takenBack(before: string[], after: string[]): number {
  const counted = after.filter((w) => !DIMENSION.test(w)).length || 1;
  let guarded = 0;
  const numericFix = HAS_DIGIT.test(after[0] ?? "");
  before.forEach((w, i) => {
    const bare = w.replace(/[^\p{L}\p{N}]/gu, "");
    if (ACTION_WORD.test(bare) && i < before.length - 1) guarded = i + 1;
    if (!numericFix && HAS_DIGIT.test(w) && i < before.length - 1) {
      guarded = i + 1;
      // the unit right after the number ("200 sqft") stays with it
      if (i + 1 < before.length - 1 && !HAS_DIGIT.test(before[i + 1])) {
        guarded = i + 2;
      }
    }
  });
  return Math.min(counted, before.length - guarded);
}

/**
 * The text with each self-correction applied: the cue goes, and so do the
 * words it takes back — as many of the clause's last words as the correction
 * itself has (never more than the clause): "LVP no wait porcelain tile 12x24"
 * → "porcelain tile 12x24", "double vanity quartz, no wait, marble" →
 * "double vanity marble", "3 windows make that 4 windows" → "4 windows".
 * Text with no cue is returned unchanged.
 */
export function dropSelfCorrections(text: string): string {
  let out = text ?? "";
  for (let guard = 0; guard < 10; guard++) {
    const m = CUE.exec(out);
    if (!m) break;
    const cueStart = m.index + m[1].length;
    const cueEnd = m.index + m[0].length;
    // the clause before the cue (from the last delimiter), minus a trailing
    // comma ("white shaker, no wait, gray")
    const head = out.slice(0, cueStart).replace(/[\s,]+$/, "");
    const clauseStart = lastDelim(head);
    const before = words(head.slice(clauseStart));
    // the correction after the cue, up to the next delimiter
    const tail = out.slice(cueEnd).replace(/^[\s,:;—–-]+/, "");
    const next = tail.search(DELIM);
    const after = words(next < 0 ? tail : tail.slice(0, next));
    if (!before.length || !after.length) {
      // nothing to take back, or nothing it is taken back for: drop the cue
      out = (out.slice(0, cueStart) + " " + tail).replace(/\s{2,}/g, " ")
        .trim();
      continue;
    }
    const keep = before.slice(0, before.length - takenBack(before, after));
    const lead = head.slice(0, clauseStart);
    const kept = keep.join(" ");
    out = (lead + (lead && !/\s$/.test(lead) ? " " : "") +
      (kept ? kept + " " : "") + tail).replace(/[ \t]{2,}/g, " ").trim();
  }
  return out;
}

/** Index just after the last clause delimiter in `s` (0 when none). */
function lastDelim(s: string): number {
  let at = 0;
  const re = new RegExp(DELIM.source, "gu");
  for (const m of s.matchAll(re)) at = (m.index ?? 0) + m[0].length;
  return at;
}

/** "same address", "same place", "misma dirección", "la misma casa". */
const SAME_ADDRESS =
  /\b(?:same\s+(?:address|place|house|location|site|property|job\s*site)|misma\s+(?:direcci[oó]n|casa|ubicaci[oó]n|propiedad)|mismo\s+(?:lugar|domicilio|sitio))\b/iu;

/** Whether the message says the job is at the customer's address on file. */
export function mentionsSameAddress(text: string): boolean {
  return SAME_ADDRESS.test(text ?? "");
}

/**
 * The address "same address" means for `customerId`: the job address of
 * their latest quote that has one, else the address on their record.
 */
export function sameAddressFor(
  customerId: string,
  quotes: ReadonlyArray<
    { customerId?: string; serviceAddress?: string; createdAt?: string }
  >,
  customer: { address?: string } | null | undefined,
): string | undefined {
  const latest = quotes
    .filter((q) => q.customerId === customerId && q.serviceAddress?.trim())
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))[0];
  return latest?.serviceAddress?.trim() || customer?.address?.trim() ||
    undefined;
}

/** Words after "email" that are not an address: "email me the quote". */
const NOT_A_VALUE = new Set([
  "me",
  "him",
  "her",
  "them",
  "it",
  "us",
  "you",
  "the",
  "a",
  "an",
  "to",
  "is",
  "and",
  "or",
  "back",
  "later",
  "address",
  "when",
  "if",
  "as",
  "too",
  "also",
  "le",
  "les",
  "lo",
  "la",
  "el",
  "es",
  "y",
  "o",
  "de",
  "del",
  "electronico",
  "electrónico",
]);

/**
 * The e-mail the message gives that is not one — "email notanemail",
 * "correo: juan@gmail" — else null (no e-mail named, or a valid one).
 */
export function malformedEmailIn(text: string): string | null {
  const s = text ?? "";
  if (extractEmail(s)) return null;
  const m = s.match(
    /\b(?:e-?mail|correo(?:\s+electr[oó]nico)?)\b(?:\s+(?:is|es|address|de))?\s*[:=]?\s*([^\s,;]+)/iu,
  );
  if (!m) return null;
  const value = m[1].replace(/[.!?)]+$/, "");
  if (!value || NOT_A_VALUE.has(value.toLowerCase())) return null;
  if (/^\$?\d[\d,.]*$/.test(value)) return null;
  return value;
}
