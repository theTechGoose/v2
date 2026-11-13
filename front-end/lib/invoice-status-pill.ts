/**
 * REQ-729 (demo-loop cycle 5, issue m16) — which pill the public invoice page
 * (/i/:id) shows beside the headline.
 *
 * The pill used to know paid / claimed / past due only, so the business's own
 * preview of a Draft INV-001 or a Scheduled INV-002 read a pink "DUE" next to
 * "Version 1 · Draft" / "Scheduled". The pink "Due" is for an issued, open
 * receivable; a bill not yet sent is a neutral state.
 *
 * REQ-558 still holds: only the business (`internal`) is told a bill is a
 * draft or scheduled — an outside viewer reads the plain "Due".
 */
import { type Lang, shortDate } from "../../shared/documents/linked-view.ts";

export type InvoicePillKind =
  | "paid"
  | "claimed"
  | "draft"
  | "scheduled"
  | "pastDue"
  | "due";

/** Colour family; the route maps it to its palette. */
export type InvoicePillTone =
  | "good"
  | "pending"
  | "neutral"
  | "teal"
  | "alert"
  | "due";

export interface InvoicePill {
  kind: InvoicePillKind;
  tone: InvoicePillTone;
  /** lang/*.json key */
  key: string;
  vars?: Record<string, string>;
}

export function invoiceStatusPill(
  input: {
    paid: boolean;
    claimed: boolean;
    pastDue: boolean;
    status?: string;
    /** the viewer is the business itself (REQ-479) */
    internal?: boolean;
    /** a scheduled installment's send date (YYYY-MM-DD) */
    scheduledFor?: string;
  },
  lang: Lang,
): InvoicePill {
  if (input.paid) return { kind: "paid", tone: "good", key: "status.paid" };
  if (input.claimed) {
    return {
      kind: "claimed",
      tone: "pending",
      key: "publicInvoice.status.awaitingConfirmation",
    };
  }
  if (input.internal && input.status === "draft") {
    return {
      kind: "draft",
      tone: "neutral",
      key: "publicInvoice.status.draft",
    };
  }
  if (input.internal && input.status === "scheduled") {
    const date = shortDate(input.scheduledFor, lang, false);
    return date
      ? {
        kind: "scheduled",
        tone: "teal",
        key: "publicInvoice.status.scheduledSends",
        vars: { date },
      }
      : {
        kind: "scheduled",
        tone: "teal",
        key: "publicInvoice.status.scheduled",
      };
  }
  if (input.pastDue) {
    return {
      kind: "pastDue",
      tone: "alert",
      key: "publicInvoice.status.pastDue",
    };
  }
  return { kind: "due", tone: "due", key: "publicInvoice.status.due" };
}
