/**
 * REQ-470 (demo-loop cycle 3, m61): the typed legal name that signs an
 * agreement. "x" signed a binding agreement because the pad and the accept
 * endpoint only asked for a non-empty string. One rule for both sides:
 *
 *   - two (or more) words that each carry a letter ("J K", "Tom K."), or
 *   - at least three letters in all ("Ann", "Zoë").
 *
 * Letters are Unicode letters (`\p{L}`), so accents and non-Latin scripts
 * count; digits and punctuation do not.
 */

const LETTER = /\p{L}/u;
const LETTERS = /\p{L}/gu;

/** Trim and collapse inner whitespace — the form the name is stored in. */
export function normalizeSignerName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/** True when `raw` is an acceptable legal name to sign with. */
export function isValidSignerName(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  const name = normalizeSignerName(raw);
  if (!name) return false;
  const words = name.split(" ").filter((w) => LETTER.test(w));
  if (words.length >= 2) return true;
  return (name.match(LETTERS)?.length ?? 0) >= 3;
}
