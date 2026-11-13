/**
 * REQ-701 (demo-loop cycle 5, issue M21) — where an answer to a client's
 * question can go.
 *
 * The public quote page's "Ask a question" form has one free-text "how should
 * we reach you back" field ("(512) 555-6301 after 5pm", "linda@…", or both).
 * The quote panel's Text back / Email back / Call and the backend's reply
 * (ReplyToInquiry) read it with this ONE rule: the phone or email the client
 * typed wins; the customer's contact on file fills the channel they did not
 * give. Pure — shared by the Deno backend, the islands and the jest suite.
 */
import { customerPhoneE164 } from "./customer-contact.ts";
import { normalizeEmail } from "./normalize-email.ts";
import { telHref } from "./format-helpers.ts";

export interface ContactBackParts {
  /** E.164 (US default), when the text holds a dialable number */
  phone?: string;
  /** lowercased, when the text holds an email address */
  email?: string;
}

const EMAIL_IN_TEXT = /[^\s@<>()[\]"',;:]+@[^\s@<>()[\]"',;:]+\.[a-z]{2,}/i;
/** a run of digits with phone punctuation, optionally led by "+" */
const PHONE_IN_TEXT = /\+?\d[\d\s().-]{5,}\d/g;

/** The phone and the email inside a free-text contact-back value. */
export function contactBackParts(
  raw: string | null | undefined,
): ContactBackParts {
  const text = (raw ?? "").trim();
  if (!text) return {};
  const out: ContactBackParts = {};
  const mail = text.match(EMAIL_IN_TEXT);
  const email = mail ? normalizeEmail(mail[0]) : null;
  if (email) out.email = email;
  // digits inside the email (linda2024@…) are never a phone
  const rest = mail ? text.replace(mail[0], " ") : text;
  for (const m of rest.match(PHONE_IN_TEXT) ?? []) {
    const phone = customerPhoneE164(m.trim());
    if (phone) {
      out.phone = phone;
      break;
    }
  }
  return out;
}

export type InquiryReplyChannel = "text" | "email";

export interface InquiryReplyTarget {
  to: string;
  /** true: the client typed it on the question; false: the customer on file */
  fromContactBack: boolean;
}

export interface InquiryReplyTargets {
  /** where Text back goes (E.164) */
  text?: InquiryReplyTarget;
  /** where Email back goes */
  email?: InquiryReplyTarget;
  /** Call: a tel: href to the same number Text back uses */
  call?: string;
  /** the channel the client asked to be reached on (the panel's primary) */
  preferred?: InquiryReplyChannel;
}

/** Where Text back, Email back and Call reach the client who asked. */
export function inquiryReplyTargets(
  inquiry: { contactBack?: string | null },
  customer?: { phoneNumber?: string | null; email?: string | null } | null,
): InquiryReplyTargets {
  const asked = contactBackParts(inquiry.contactBack);
  const filePhone = customer?.phoneNumber
    ? customerPhoneE164(customer.phoneNumber)
    : null;
  const fileEmail = customer?.email ? normalizeEmail(customer.email) : null;
  const out: InquiryReplyTargets = {};
  if (asked.phone) out.text = { to: asked.phone, fromContactBack: true };
  else if (filePhone) out.text = { to: filePhone, fromContactBack: false };
  if (asked.email) out.email = { to: asked.email, fromContactBack: true };
  else if (fileEmail) out.email = { to: fileEmail, fromContactBack: false };
  if (out.text) out.call = telHref(out.text.to);
  const preferred: InquiryReplyChannel | undefined = asked.phone
    ? "text"
    : asked.email
    ? "email"
    : undefined;
  if (preferred) out.preferred = preferred;
  return out;
}
