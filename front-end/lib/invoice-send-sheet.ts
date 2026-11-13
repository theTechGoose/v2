/**
 * REQ-727 (demo-loop cycle 5, c4-M16 / m56) — the invoice send sheet's pure
 * rules. On /invoices "Issue invoice", "Finish + send" and "Send now" used
 * to send over email AND text the moment they were pressed. Now each opens
 * the send sheet (components/InvoiceSendDialog.tsx); only its Send
 * dispatches — the picked channel(s), in the picked language.
 *
 * Pure: shared by the island and its tests.
 */
import type {
  SendChannel,
  SendDialogCustomer,
  SendDialogPick,
} from "./send-dialog.ts";
import type { DispatchChannel } from "../../shared/quote-flow/send-result.ts";
import { dueDateFrom } from "../../shared/documents/invoice-form.ts";

/** The endpoints a pick posts to (POST /invoices/:id/email | /text). */
export function dispatchChannels(channel: SendChannel): DispatchChannel[] {
  if (channel === "email") return ["email"];
  if (channel === "sms") return ["text"];
  return ["email", "text"];
}

/**
 * One dispatch POST's JSON body: the picked language, and — only when the
 * invoice has no customer record to keep it (the sheet saves a typed
 * contact on the customer otherwise) — the typed address as `to`.
 */
export function invoiceDispatchBody(
  channel: DispatchChannel,
  pick: Partial<Pick<SendDialogPick, "language">> & {
    typed?: Partial<SendDialogPick["typed"]>;
  },
  hasCustomer: boolean,
): { language?: "en" | "es"; to?: string } {
  const typed = (channel === "email" ? pick.typed?.email : pick.typed?.phone)
    ?.trim();
  return {
    ...(pick.language ? { language: pick.language } : {}),
    ...(!hasCustomer && typed ? { to: typed } : {}),
  };
}

interface ContactLike {
  name?: string | null;
  businessName?: string | null;
  email?: string | null;
  phoneNumber?: string | null;
}

const text = (v: string | null | undefined): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

/** doc-render's rule: a bill-to / snapshot is on the document only when it
 *  names someone. */
function named(c: ContactLike | null | undefined): ContactLike | undefined {
  return c && (text(c.name) || text(c.businessName)) ? c : undefined;
}

/**
 * The contact the sheet shows as on file — the one the send endpoints reach:
 * the customer's live record first (a corrected address should reach them),
 * else the invoice's named bill-to, else its snapshot. The id is the
 * invoice's customer, where a contact typed in the sheet is saved.
 */
export function invoiceSendContact(
  inv: {
    customerId?: string;
    billTo?: ContactLike | null;
    customerSnapshot?: ContactLike | null;
  },
  customer: (ContactLike & { id?: string }) | null | undefined,
): SendDialogCustomer {
  const doc = named(inv.billTo) ?? named(inv.customerSnapshot);
  const id = inv.customerId ?? customer?.id;
  const name = text(customer?.name) ?? text(doc?.name) ??
    text(doc?.businessName);
  const email = text(customer?.email) ?? text(doc?.email);
  const phoneNumber = text(customer?.phoneNumber) ?? text(doc?.phoneNumber);
  return {
    ...(id ? { id } : {}),
    ...(name ? { name } : {}),
    ...(email ? { email } : {}),
    ...(phoneNumber ? { phoneNumber } : {}),
  };
}

/** "Sends in" starts on the invoice's own typed language (REQ-497) when the
 *  page knows it; undefined → the sheet asks the server, which also knows
 *  the language a quote-linked invoice's quote went out in. */
export function invoiceSheetLang(
  inv: { lang?: string | null },
): "en" | "es" | undefined {
  return inv.lang === "en" || inv.lang === "es" ? inv.lang : undefined;
}

/**
 * REQ-174 / REQ-480: "Finish + send" issues a draft today when it has no
 * issue date, and makes it due today + its days to pay — stamped before the
 * dispatch, and the dates the sheet's preview shows.
 */
export function finishDraftDates(
  inv: { issuedDate?: string; netDays?: number },
  todayIso: string,
): { issuedDate?: string; dueDate?: string } {
  return {
    ...(inv.issuedDate ? {} : { issuedDate: todayIso }),
    ...(typeof inv.netDays === "number"
      ? { dueDate: dueDateFrom(todayIso, inv.netDays) }
      : {}),
  };
}
