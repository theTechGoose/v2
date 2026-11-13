/**
 * REQ-523 (demo-loop cycle 3, issue m16): the public invoice (/i/:id)
 * promises a payment receipt only on a channel it can arrive on. Pair 9's
 * customer — 5125550142, a fictional 555-01XX number, no email — claimed a
 * Zelle payment and read "we'll text you a receipt then."
 *
 * The server says where the receipt goes (`receiptChannel` on
 * `GET /invoices/:id/public`, REQ-403's rule over the record ConfirmPayment
 * sends to): "email" when the customer has an email, "text" only to a number
 * that can take a text, "none" otherwise — then the page promises no receipt
 * and says the page itself will show the payment once it is confirmed.
 *
 * Pure: the island and the route map the channel to a dictionary key here.
 */
export type ReceiptChannel = "email" | "text" | "none";

/** The server's channel; an older payload without one falls back to the
 *  email it can see, else no promise — never a text. */
export function receiptChannelOf(inv: {
  receiptChannel?: string | null;
  customer?: { email?: string | null } | null;
}): ReceiptChannel {
  const ch = inv.receiptChannel;
  if (ch === "email" || ch === "text" || ch === "none") return ch;
  if (ch) return "none";
  return inv.customer?.email?.trim() ? "email" : "none";
}

export type ClaimThanksKey =
  | "publicInvoiceClaim.thanksBody"
  | "publicInvoiceClaim.thanksBodyEmail"
  | "publicInvoiceClaim.thanksBodyNone";

/** The line under "Thanks!" right after the customer's claim. */
export function claimThanksKey(
  channel: ReceiptChannel | undefined,
): ClaimThanksKey {
  if (channel === "text") return "publicInvoiceClaim.thanksBody";
  if (channel === "email") return "publicInvoiceClaim.thanksBodyEmail";
  return "publicInvoiceClaim.thanksBodyNone";
}

export type ClaimedNoteKey =
  | "publicInvoice.claimed.body"
  | "publicInvoice.claimed.bodyEmail"
  | "publicInvoice.claimed.bodyNone";

/** The claimed note's last line (the page opened on a claimed invoice). */
export function claimedNoteKey(
  channel: ReceiptChannel | undefined,
): ClaimedNoteKey {
  if (channel === "text") return "publicInvoice.claimed.body";
  if (channel === "email") return "publicInvoice.claimed.bodyEmail";
  return "publicInvoice.claimed.bodyNone";
}
