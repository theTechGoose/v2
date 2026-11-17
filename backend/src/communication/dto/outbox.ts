/**
 * REQ-784 (demo-loop cycle dv1, issue d12) — the business's outbox: one
 * entry per email or text that went, or was meant to go, to a customer.
 * Raphael: "And yes to a sent message outbox."
 */

export type OutboxChannel = "email" | "text";

/** "not_sent": the message never reached the provider, or the provider
 *  refused it — `reasonCode` / `reason` say why. */
export type OutboxStatus = "sent" | "not_sent";

/** What the message carried — the page's "What" column. */
export type OutboxKind =
  | "quote"
  | "invoice"
  | "invoicePaid"
  | "changeOrder"
  | "receipt"
  | "signedCopy"
  | "reminder"
  | "reply";

export const OUTBOX_KINDS: readonly OutboxKind[] = [
  "quote",
  "invoice",
  "invoicePaid",
  "changeOrder",
  "receipt",
  "signedCopy",
  "reminder",
  "reply",
];

/** One customer message as the list shows it — no body. */
export interface OutboxEntry {
  id: string;
  /** the account it went out from (every record is user-owned) */
  userId: string;
  createdAt: string;
  channel: OutboxChannel;
  status: OutboxStatus;
  /** why it didn't go, as a code the page words in its own language:
   *  a text's SmsFailureCode (missing / invalid / fictional / notMobile /
   *  optedOut / other), or "missing" / "other" for an email */
  reasonCode?: string;
  /** …and as the sender worded it at send time (fallback, logs) */
  reason?: string;
  /** the language the message went out in */
  language: "en" | "es";
  kind: OutboxKind;
  customerId?: string;
  /** the customer as the document named them at send time */
  customerName?: string;
  /** the email address or E.164 number it went (or would have gone) to */
  to?: string;
  /** the document it carried: its id and number (Q-001, INV-001, CO-001…) */
  docId?: string;
  docRef?: string;
  /** an email's subject */
  subject?: string;
  /** the list's line: the subject (email) or the first line (text) */
  preview: string;
  /** how many KV pages hold the body (0: nothing went) */
  bodyPages: number;
}

/** One opened message: the entry plus its content exactly as sent — the
 *  email's HTML or the text's words; "" when nothing went. */
export interface OutboxMessage extends OutboxEntry {
  body: string;
}
