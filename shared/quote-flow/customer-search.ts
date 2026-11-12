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

/** a blank query matches all; otherwise name, business, email, address or notes
 *  (accent- and case-blind), or the phone by its digits (three or more) */
export function customerMatchesQuery(
  c: SearchableCustomer,
  q: string | undefined | null,
): boolean {
  const needle = foldSearch(q ?? "");
  if (!needle) return true;
  const texts = [c.name, c.businessName, c.email, c.address, c.notes];
  if (texts.some((t) => foldSearch(t ?? "").includes(needle))) return true;
  const digits = needle.replace(/\D/g, "");
  return digits.length >= 3 &&
    (c.phoneNumber ?? "").replace(/\D/g, "").includes(digits);
}
