/**
 * REQ-556 (demo-loop cycle 4, issue M7): the contractor's pages say what was
 * delivered, read from what the backend recorded — never a fixed "sent".
 *
 *   - `receiptSentVia` (MarkInvoicePaid / ConfirmPayment): where the paid
 *     receipt went — "email" | "text" | "none";
 *   - `deliveredVia` (SendSignedConfirmation): how the invoice signing billed
 *     reached the customer — [] means nobody;
 *   - the nudge's `reason` (SendPaymentReminder.runForInvoice): why nothing
 *     went out.
 *
 * Pure: each helper maps a record to a dictionary key.
 */
import type { ReceiptChannel } from "./receipt-note.ts";

/** The recorded receipt channel, or undefined for a record without one. */
export function receiptSentViaOf(raw: unknown): ReceiptChannel | undefined {
  return raw === "email" || raw === "text" || raw === "none" ? raw : undefined;
}

export type PaidReadKey =
  | "invoicesPage.read.paid"
  | "invoicesPage.read.paidText"
  | "invoicesPage.read.paidNone"
  | "invoicesPage.read.paidPlain";

/** The paid card's line: emailed / texted / couldn't be sent — and, for an
 *  invoice paid before delivery was recorded, no claim at all. */
export function paidReadKey(
  inv: { receiptSentVia?: string | null },
): PaidReadKey {
  switch (receiptSentViaOf(inv.receiptSentVia)) {
    case "email":
      return "invoicesPage.read.paid";
    case "text":
      return "invoicesPage.read.paidText";
    case "none":
      return "invoicesPage.read.paidNone";
    default:
      return "invoicesPage.read.paidPlain";
  }
}

/** True when signing recorded that its invoice reached nobody. */
export function wasUndelivered(
  inv: { deliveredVia?: readonly string[] | null },
): boolean {
  return Array.isArray(inv.deliveredVia) && inv.deliveredVia.length === 0;
}

/** The "out" card's line: "Issued … Due …", or that nobody was sent it. */
export function outReadKey(
  inv: { deliveredVia?: readonly string[] | null },
): "invoicesPage.read.out" | "invoicesPage.read.outUndelivered" {
  return wasUndelivered(inv)
    ? "invoicesPage.read.outUndelivered"
    : "invoicesPage.read.out";
}

export interface NudgeReply {
  channels?: string[];
  reason?: string;
}

export interface NudgeNote {
  /** "fail" renders as the card's error line, "note" as its info line */
  tone: "note" | "fail";
  key:
    | "invoicesPage.nudge.sent"
    | "invoicesPage.nudge.alreadySent"
    | "invoicesPage.nudge.muted"
    | "invoicesPage.nudge.noRecipient"
    | "invoicesPage.nudge.notDelivered"
    | "invoicesPage.nudge.failed";
}

/** What the overdue card says after "Send a nudge" — `null` is a failed
 *  request. */
export function nudgeNote(body: NudgeReply | null): NudgeNote {
  if (!body) return { tone: "fail", key: "invoicesPage.nudge.failed" };
  if (Array.isArray(body.channels) && body.channels.length > 0) {
    return { tone: "note", key: "invoicesPage.nudge.sent" };
  }
  switch (body.reason) {
    case "no_recipient":
      return { tone: "fail", key: "invoicesPage.nudge.noRecipient" };
    case "not_delivered":
      return { tone: "fail", key: "invoicesPage.nudge.notDelivered" };
    case "muted":
      return { tone: "note", key: "invoicesPage.nudge.muted" };
    default:
      // already_fired (or the Day-30 escalation, which texts nobody)
      return { tone: "note", key: "invoicesPage.nudge.alreadySent" };
  }
}
