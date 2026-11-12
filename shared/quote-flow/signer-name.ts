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

/** Lowercase, accent-free, whitespace-collapsed — for spelling comparison. */
function foldName(raw: string): string {
  return normalizeSignerName(raw).normalize("NFD").replace(/\p{M}/gu, "")
    .toLowerCase();
}

/**
 * REQ-692 (demo-loop cycle 5, p18-6a): "Carmen Nunez" signed an agreement
 * made out to "Carmen Núñez" and the page showed both spellings. When the
 * typed name differs from the name on file only by accents or case, return
 * the on-file spelling to suggest; otherwise undefined. A suggestion only —
 * any valid typed name still signs (rejecting a mismatch is the owner's call).
 */
export function onFileSpellingSuggestion(
  typed: string,
  onFile: string | undefined,
): string | undefined {
  if (!onFile) return undefined;
  const want = normalizeSignerName(onFile);
  const got = normalizeSignerName(typed);
  if (!want || !got || got === want) return undefined;
  return foldName(got) === foldName(want) ? want : undefined;
}
