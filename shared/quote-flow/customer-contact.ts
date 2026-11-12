/**
 * REQ-278 (demo M16) — the ONE rule for "is this a usable customer contact",
 * applied when a customer is SAVED: the backend DTO gate, the assistant's
 * create_new path, the assistant's "Who is this for?" form and the
 * /customers "Add client" modal all ask this module.
 *
 * The phone rule is the same one the SMS send path dials with
 * (send-paperwork-sms `normalizeE164`), so a number that is accepted here is a
 * number the send path can text — "123", "555-12" and "512-555-01" are not.
 * The email rule is REQ-050's address shape (normalize-email.ts), so
 * "davis@@gmail", "carl@" and "carl@x" are not addresses.
 *
 * Blank is not a format error: whether a contact is REQUIRED is the form's
 * call (the assistant requires one channel; the /customers modal does not).
 */
import { normalizeEmail } from "./normalize-email.ts";

/** E.164 form of a typed customer phone, or null when it cannot be dialled. */
export function customerPhoneE164(raw: string): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  if (/^\+[1-9]\d{6,14}$/.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) {
    return /^[1-9]\d{6,14}$/.test(digits) ? `+${digits}` : null;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export function isValidCustomerPhone(raw: string): boolean {
  return customerPhoneE164(raw) !== null;
}

export function isValidCustomerEmail(raw: string): boolean {
  return normalizeEmail(raw ?? "") !== null;
}

export type CustomerContactErrorKey =
  | "customer.invalidPhone"
  | "customer.invalidEmail";

/**
 * The dictionary key naming the first malformed field, or null when every
 * non-blank field is well-formed. Phone is checked first (the form shows it
 * first).
 */
export function customerContactError(
  contact: { email?: string | null; phoneNumber?: string | null },
): CustomerContactErrorKey | null {
  const phone = (contact.phoneNumber ?? "").trim();
  const email = (contact.email ?? "").trim();
  if (phone && !isValidCustomerPhone(phone)) return "customer.invalidPhone";
  if (email && !isValidCustomerEmail(email)) return "customer.invalidEmail";
  return null;
}

/**
 * REQ-300 (demo cycle 1, M20) — a New customer draft with anything typed in it: the dialog's
 * backdrop click closes the dialog only while this is false, so a stray click (the demo pill
 * moving under a hand, a mis-aimed tap) never throws typed text away.
 */
export function customerDraftDirty(d: {
  name: string;
  businessName: string;
  phoneNumber: string;
  email: string;
}): boolean {
  return [d.name, d.businessName, d.phoneNumber, d.email].some((v) =>
    v.trim() !== ""
  );
}
