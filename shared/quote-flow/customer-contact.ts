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
import { phoneKey } from "./customer-dedupe.ts";

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
 * REQ-352 (demo-loop cycle 1, demo M38) — the New customer modal's rule, one
 * message PER FIELD so each sits under its own input: a name is required, the
 * phone and the email are checked with the rules above. An empty object means
 * the customer can be saved.
 */
export interface CustomerFormErrors {
  name?: "customer.nameRequired";
  phone?: "customer.invalidPhone";
  email?: "customer.invalidEmail";
}

export function customerFormErrors(
  form: {
    name?: string | null;
    email?: string | null;
    phoneNumber?: string | null;
  },
): CustomerFormErrors {
  const out: CustomerFormErrors = {};
  if (!(form.name ?? "").trim()) out.name = "customer.nameRequired";
  const phone = (form.phoneNumber ?? "").trim();
  const email = (form.email ?? "").trim();
  if (phone && !isValidCustomerPhone(phone)) {
    out.phone = "customer.invalidPhone";
  }
  if (email && !isValidCustomerEmail(email)) {
    out.email = "customer.invalidEmail";
  }
  return out;
}

/**
 * REQ-300 (demo cycle 1, M20) — a New customer draft with anything typed in it: the dialog's
 * backdrop click closes the dialog only while this is false, so a stray click (the demo pill
 * moving under a hand, a mis-aimed tap) never throws typed text away.
 */
export function customerDraftDirty(d: NewCustomerDraft): boolean {
  return [
    d.name,
    d.businessName,
    d.phoneNumber,
    d.email,
    d.address ?? "",
    d.language ?? "", // REQ-715: a picked language is part of the draft
  ].some((v) => v.trim() !== "");
}

/**
 * The New customer modal's typed values. REQ-599 (demo-loop cycle 4, m30):
 * `address` is the modal's optional Address field. REQ-715 (demo-loop cycle
 * 5, m31): `language` is the customer's language ("en" | "es"; "" = not set).
 */
export interface NewCustomerDraft {
  name: string;
  businessName: string;
  phoneNumber: string;
  email: string;
  address?: string;
  language?: string;
}

/**
 * REQ-599 (demo-loop cycle 4, m30) — the POST /customers body for a New
 * customer draft: every value trimmed, blank optional fields left out (so a
 * blank address never overwrites "No address on file" with "").
 */
export function newCustomerPayload(d: NewCustomerDraft): {
  name: string;
  businessName?: string;
  phoneNumber?: string;
  email?: string;
  address?: string;
  language?: "en" | "es";
} {
  const out: ReturnType<typeof newCustomerPayload> = { name: d.name.trim() };
  const businessName = d.businessName.trim();
  const phoneNumber = d.phoneNumber.trim();
  const email = d.email.trim();
  const address = (d.address ?? "").trim();
  const language = (d.language ?? "").trim();
  if (businessName) out.businessName = businessName;
  if (phoneNumber) out.phoneNumber = phoneNumber;
  if (email) out.email = email;
  if (address) out.address = address;
  // REQ-715: "Not set" (or anything but en | es) sends no language at all
  if (language === "en" || language === "es") out.language = language;
  return out;
}

/**
 * REQ-390 (demo-loop cycle 2, m18 / m19) — the assistant's "Who is this for?"
 * form, one message PER FIELD (customerFormErrors' rule plus the form's own
 * two: a contact is required, and it must not be the contractor's own):
 *  - `name`: shown once the name field was left empty (`nameTouched`);
 *  - `phone` / `email`: the contractor's own (at once — it can only match a
 *    whole number / address), or a malformed value once THAT field was left
 *    (`phoneTouched` / `emailTouched`; REQ-524, demo-loop cycle 3
 *    p8-pair7-a — "Enter a full phone number" showed after the first digit,
 *    while she was still typing). A malformed value blocks `canSubmit` either
 *    way; only the message waits;
 *  - `contact`: no phone and no email. REQ-029 keeps the reason visible from
 *    the start, as a neutral `hint`; it becomes an `error` once a contact
 *    field was typed in or left (`contactTouched`).
 * `canSubmit` is the Next button's rule.
 */
export interface CustomerStepFeedback {
  name?: "customer.nameRequired";
  phone?: "customer.invalidPhone" | "asstChat.customerStep.ownPhone";
  email?: "customer.invalidEmail" | "asstChat.customerStep.ownEmail";
  contact?: {
    key: "asstChat.customerStep.needContact";
    tone: "hint" | "error";
  };
  canSubmit: boolean;
}

export function customerStepFeedback(
  form: {
    name?: string | null;
    email?: string | null;
    phoneNumber?: string | null;
  },
  opts: {
    ownerEmail?: string | null;
    ownerPhone?: string | null;
    nameTouched?: boolean;
    contactTouched?: boolean;
    phoneTouched?: boolean;
    emailTouched?: boolean;
  },
): CustomerStepFeedback {
  const base = customerFormErrors(form);
  const phone = (form.phoneNumber ?? "").trim();
  const email = (form.email ?? "").trim();
  const out: CustomerStepFeedback = { canSubmit: false };
  if (base.name && opts.nameTouched) out.name = base.name;
  const ownPhone = !!phone && !!opts.ownerPhone &&
    phoneKey(phone) === phoneKey(opts.ownerPhone);
  const ownEmail = !!email && !!opts.ownerEmail &&
    email.toLowerCase() === opts.ownerEmail.trim().toLowerCase();
  if (ownPhone) out.phone = "asstChat.customerStep.ownPhone";
  else if (base.phone && opts.phoneTouched) out.phone = base.phone;
  if (ownEmail) out.email = "asstChat.customerStep.ownEmail";
  else if (base.email && opts.emailTouched) out.email = base.email;
  if (!phone && !email) {
    out.contact = {
      key: "asstChat.customerStep.needContact",
      tone: opts.contactTouched ? "error" : "hint",
    };
  }
  out.canSubmit = !base.name && !base.phone && !base.email && !ownPhone &&
    !ownEmail && !out.contact;
  if (out.canSubmit) return { canSubmit: true };
  return out;
}
