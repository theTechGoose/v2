/**
 * REQ-331 (demo-loop cycle 1, m44 / m7) — the same-owner customer a
 * "create" would duplicate, and the one customer the wizard's customer step
 * can offer with one tap ("Use María López ✓ / change").
 *
 * Shared by the backend (handle-wizard-answer's create_new, the chat path's
 * create_quote) and the island (the create form's live "already exists"
 * hint, the customer step's known-customer card), so both sides agree on
 * what "the same customer" means: the phone's trailing 10 digits, the email
 * case-blind, or the whole name accent- and case-blind. Pure logic.
 */
import type { QuoteFacts } from "./quote-facts.ts";

export interface DedupableCustomer {
  id: string;
  name: string;
  email?: string | null;
  phoneNumber?: string | null;
}

export interface CustomerContact {
  name?: string | null;
  email?: string | null;
  phoneNumber?: string | null;
}

export const foldName = (s: string | null | undefined): string =>
  (s ?? "").normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ")
    .trim().toLowerCase();

/** The trailing 10 digits — "+1 (512) 555-0199" and "5125550199" agree. */
export const phoneKey = (p: string | null | undefined): string => {
  const d = (p ?? "").replace(/\D/g, "");
  return d.length > 10 ? d.slice(-10) : d;
};

const emailKey = (e: string | null | undefined): string =>
  (e ?? "").trim().toLowerCase();

/**
 * The existing customer `contact` would duplicate — by phone, then email,
 * then the WHOLE name (a partial name while typing never matches). null when
 * nobody matches or there is nothing to match on.
 */
export function findExistingCustomer<C extends DedupableCustomer>(
  customers: C[] | null | undefined,
  contact: CustomerContact,
): C | null {
  const list = customers ?? [];
  if (list.length === 0) return null;
  const phone = phoneKey(contact.phoneNumber);
  if (phone.length === 10) {
    const hit = list.find((c) => phoneKey(c.phoneNumber) === phone);
    if (hit) return hit;
  }
  const email = emailKey(contact.email);
  if (email) {
    const hit = list.find((c) => emailKey(c.email) === email);
    if (hit) return hit;
  }
  const name = foldName(contact.name);
  if (name) {
    const hit = list.find((c) => foldName(c.name) === name);
    if (hit) return hit;
  }
  return null;
}

/** Letter words of a text or a name, in order ("María López," → two). */
const words = (s: string): string[] =>
  s.split(/[^\p{L}\p{N}'’-]+/u).filter(Boolean);

/**
 * REQ-386 (demo-loop cycle 2, m17) — the one same-owner customer whose WHOLE
 * name is typed in the text as Capitalized words ("Bob wants 6 recessed
 * lights" → the existing "Bob"; "Maria Lopez" → "María López"), accent- and
 * case-blind on the letters. A lowercase word ("bob the roof"), a longer word
 * ("Bobby") or part of a name ("Maria" for "María López") never matches; two
 * different customers named → null (never a guess).
 */
export function findCustomerNamedInText<C extends DedupableCustomer>(
  customers: C[] | null | undefined,
  text: string | null | undefined,
): C | null {
  const typed = words(text ?? "");
  const folded = typed.map((w) => foldName(w));
  const hits = new Map<string, C>();
  for (const c of customers ?? []) {
    const name = words(c.name).map((w) => foldName(w));
    if (name.length === 0 || name.join(" ").length < 2) continue;
    for (let i = 0; i + name.length <= typed.length; i++) {
      const same = name.every((w, k) =>
        folded[i + k] === w && /^\p{Lu}/u.test(typed[i + k])
      );
      if (same) {
        hits.set(c.id, c);
        break;
      }
    }
  }
  if (hits.size !== 1) return null;
  return [...hits.values()][0];
}

export interface KnownCustomer<C extends DedupableCustomer> {
  /** "bound": the thread already carries them; "match": the typed facts
   *  name a customer the account has. */
  source: "bound" | "match";
  customer: C;
}

/**
 * The customer the step can offer with one tap: the thread's bound customer
 * first; else the existing customer the typed facts name (phone / email /
 * name); else null — the step shows its pick list or create form as before.
 */
export function knownCustomerForStep<C extends DedupableCustomer>(
  bound: C | null | undefined,
  customers: C[] | null | undefined,
  facts: QuoteFacts | null | undefined,
): KnownCustomer<C> | null {
  if (bound) return { source: "bound", customer: bound };
  if (!facts) return null;
  const match = findExistingCustomer(customers, {
    name: facts.customerName,
    email: facts.customerEmail,
    phoneNumber: facts.customerPhone,
  });
  return match ? { source: "match", customer: match } : null;
}
