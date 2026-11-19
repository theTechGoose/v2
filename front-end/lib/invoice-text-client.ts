/**
 * REQ-691 (demo-loop cycle 5, issue p15): the invoice card offers "Text
 * client" only when there is a phone the text can actually go to.
 *
 * The phone is the one POST /api/invoices/:id/text dials
 * (send-paperwork-sms: the linked customer's phoneNumber, else the one on the
 * document's bill-to / snapshot). It is textable when it is a well-formed
 * number that is not in the fictional 555 block (REQ-569's shared rule).
 * Pure, so it is tested in lib/c5-preview-ask-textclient.test.tsx.
 */
import { customerPhoneE164 } from "../../shared/quote-flow/customer-contact.ts";
import { phoneCantReceiveTexts } from "../../shared/quote-flow/sms-number.ts";

type WithPhone = { phoneNumber?: unknown } | null | undefined;

function phoneOf(x: WithPhone): string | null {
  const p = x?.phoneNumber;
  return typeof p === "string" && p.trim() ? p : null;
}

/** the phone a "Text client" on this invoice would go to, or null */
export function invoiceTextPhone(
  inv: { billTo?: WithPhone; customerSnapshot?: unknown },
  customer: WithPhone,
): string | null {
  return phoneOf(customer) ?? phoneOf(inv.billTo) ??
    phoneOf(inv.customerSnapshot as WithPhone);
}

/**
 * REQ-982 (LOOP-007 q1-65; AMENDMENT to REQ-691): why "Text client" is or
 * isn't offered — no phone, a malformed one, or one that can't receive texts
 * (the fictional 555 block) each get their own fallback on the card.
 */
export type TextClientState = "ok" | "missing" | "invalid" | "cantText";

export function textClientState(
  phone: string | null | undefined,
): TextClientState {
  if (!phone?.trim()) return "missing";
  if (!customerPhoneE164(phone)) return "invalid";
  return phoneCantReceiveTexts(phone) ? "cantText" : "ok";
}

/** a phone is present, well-formed and able to take a text */
export function canTextClient(phone: string | null | undefined): boolean {
  return textClientState(phone) === "ok";
}

type WithEmail = { email?: unknown } | null | undefined;

function emailOf(x: WithEmail): string | null {
  const e = x?.email;
  return typeof e === "string" && e.includes("@") ? e.trim() : null;
}

/** REQ-985 (LOOP-007 q1-63): the email a reminder on this invoice would go
 *  to — the linked customer's, else the bill-to / snapshot one — or null. */
export function invoiceContactEmail(
  inv: { billTo?: WithEmail; customerSnapshot?: unknown },
  customer: WithEmail,
): string | null {
  return emailOf(customer) ?? emailOf(inv.billTo) ??
    emailOf(inv.customerSnapshot as WithEmail);
}
