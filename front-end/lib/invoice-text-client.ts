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

/** a phone is present, well-formed and able to take a text */
export function canTextClient(phone: string | null | undefined): boolean {
  if (!phone?.trim()) return false;
  if (!customerPhoneE164(phone)) return false;
  return !phoneCantReceiveTexts(phone);
}
