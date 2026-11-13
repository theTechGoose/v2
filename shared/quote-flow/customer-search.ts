/**
 * REQ-279 (demo M32) — one customer search, accent- and case-blind, for the
 * back end (GET /customers ?q=, the /customers page) and the assistant's
 * "Choose a customer" picker alike. "maria" finds "María José Peña", and
 * "María" finds "Maria": a contractor typing without accents must see the
 * customer who is already there, not an offer to create a duplicate.
 */

/** lower-case, accents stripped (NFD + combining marks), whitespace collapsed */
export function foldSearch(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/\s+/g, " ").trim();
}

export interface SearchableCustomer {
  name?: string | null;
  businessName?: string | null;
  email?: string | null;
  phoneNumber?: string | null;
  address?: string | null;
  notes?: string | null;
}

/**
 * REQ-519 (demo cycle 3, M33) — does every word of `q` appear somewhere in
 * `hays`? Accent- and case-blind, any order, words may be skipped: "maria pena"
 * finds "María José Peña". A blank query matches.
 */
export function textsMatchAllWords(
  hays: ReadonlyArray<string | undefined | null>,
  q: string,
): boolean {
  const words = foldSearch(q).split(" ").filter(Boolean);
  const folded = hays.filter((h): h is string => typeof h === "string")
    .map(foldSearch);
  return words.every((w) => folded.some((h) => h.includes(w)));
}

/** a blank query matches all; otherwise every word of it in name, business, email,
 *  address or notes (accent- and case-blind, any order — REQ-519), or the phone by
 *  its digits (three or more) */
export function customerMatchesQuery(
  c: SearchableCustomer,
  q: string | undefined | null,
): boolean {
  const needle = foldSearch(q ?? "");
  if (!needle) return true;
  const texts = [c.name, c.businessName, c.email, c.address, c.notes];
  if (textsMatchAllWords(texts, needle)) return true;
  const digits = needle.replace(/\D/g, "");
  return digits.length >= 3 &&
    (c.phoneNumber ?? "").replace(/\D/g, "").includes(digits);
}
