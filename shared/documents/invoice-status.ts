/**
 * REQ-966 (LOOP-007 q1-41, q1-64) — an invoice's status as the app shows it,
 * in one place: the /i pill, the invoice PDF's stamp and the CSV export's
 * Status column. The stored `status` is not what a person reads — a part
 * payment stores "pending" and "overdue" is never stored; both are derived
 * here at read time.
 *
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
import { type Lang, shortDate } from "./linked-view.ts";
import type { DocState } from "./versions.ts";

export type InvoicePillKind =
  | "void"
  | "paid"
  | "claimed"
  | "draft"
  | "scheduled"
  | "pastDue"
  | "partly"
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
    /** REQ-627: the business voided it — it says so and cannot be paid */
    voided?: boolean;
    /** REQ-1073: money is on it and a balance remains (`isPartlyPaid`) */
    partlyPaid?: boolean;
  },
  lang: Lang,
): InvoicePill {
  if (input.voided) {
    return {
      kind: "void",
      tone: "neutral",
      key: "publicInvoice.cancelled.pill",
    };
  }
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
  // REQ-1073: past due wins (REQ-966's order); otherwise an open bill with
  // money on it reads "Partly paid", as every other screen says
  if (input.partlyPaid) {
    return {
      kind: "partly",
      tone: "pending",
      key: "publicInvoice.status.partlyPaid",
    };
  }
  return { kind: "due", tone: "due", key: "publicInvoice.status.due" };
}

/** The fields the status derivations read. */
export interface InvoiceStatusInput {
  status?: string;
  paidAt?: string | null;
  dueDate?: string;
  paidCents?: number;
  /** the total, in cents */
  amount?: number;
  /** REQ-557: a customer's "I paid" claim */
  paymentIntent?: unknown;
}

/**
 * REQ-966: the /i rule — a due date is due through its whole (UTC) day, so
 * the invoice is past due only once that day has ended.
 */
export function isPastDue(dueDate: string | undefined, now: Date): boolean {
  if (!dueDate) return false;
  const due = new Date(`${dueDate.slice(0, 10)}T23:59:59Z`);
  return Number.isFinite(due.getTime()) && due.getTime() < now.getTime();
}

/**
 * REQ-1073 (LOOP-007 q2-62): the one "partly paid" rule every screen reads —
 * the customer Invoices tab, the /invoices card, the header search, /i and
 * its PDF, the CSV. An open bill (not void, not paid) with money recorded on
 * it and a balance still owed. The stored "pending" is NOT the signal: it is
 * also what ComputeInvoiceBalance leaves after every payment is deleted.
 * Whether "overdue" outranks it is each caller's order (REQ-966: it does).
 */
export function isPartlyPaid(
  invoice: Pick<
    InvoiceStatusInput,
    "status" | "paidAt" | "paidCents" | "amount"
  >,
): boolean {
  if (invoice.status === "void" || invoice.status === "paid") return false;
  if (invoice.paidAt) return false;
  const paid = invoice.paidCents ?? 0;
  if (paid <= 0) return false;
  return typeof invoice.amount !== "number" || paid < invoice.amount;
}

/**
 * REQ-1139 (LOOP-007 q3-70): the state word the REQ-201 headline
 * ("INV-001 · Version 1 · <state>") carries, by the same partly-paid rule as
 * the pill and the /invoices stage chip (REQ-1073 `isPartlyPaid`). A plain
 * "sent" with money on it reads "partly" ("Partly paid" / "Pago parcial");
 * every other state — paid, void, claimed, draft, scheduled, and "revised"
 * (whose line says the bill replaces an earlier version) — is kept.
 */
export function invoiceHeadlineState<S extends DocState | string>(
  state: S,
  invoice: Pick<
    InvoiceStatusInput,
    "status" | "paidAt" | "paidCents" | "amount"
  >,
): S | "partly" {
  return state === "sent" && isPartlyPaid(invoice) ? "partly" : state;
}

/**
 * REQ-966: the flags the /i pill and the invoice PDF's stamp are drawn from —
 * void, then paid, then claimed, then past due, then (REQ-1073) partly paid.
 */
export function invoicePillFlags(
  invoice: InvoiceStatusInput,
  now: Date,
): {
  voided: boolean;
  paid: boolean;
  claimed: boolean;
  pastDue: boolean;
  partlyPaid: boolean;
} {
  const voided = invoice.status === "void";
  const paid = !voided && (invoice.status === "paid" || !!invoice.paidAt);
  const claimed = !voided && invoice.status === "claimed" &&
    !!invoice.paymentIntent;
  const pastDue = !voided && !paid && !claimed &&
    isPastDue(invoice.dueDate, now);
  const partlyPaid = !voided && !paid && !claimed && !pastDue &&
    isPartlyPaid(invoice);
  return { voided, paid, claimed, pastDue, partlyPaid };
}

/**
 * REQ-966: the backend's overdue rule (invoice-aging `isOverdue`, behind
 * GET /invoices' `urgency`): unpaid and the due date's instant has passed.
 */
export function isInvoiceOverdue(
  invoice: Pick<InvoiceStatusInput, "dueDate" | "status" | "paidAt">,
  now: Date,
): boolean {
  if (invoice.paidAt) return false;
  if (invoice.status === "paid") return false;
  return new Date(invoice.dueDate ?? "").getTime() < now.getTime();
}

/** Statuses a person reads as they are stored. */
const KEPT = new Set(["void", "draft", "scheduled", "claimed"]);

/**
 * REQ-966 (AMENDMENT to REQ-208): the status the CSV export prints — what
 * GET /invoices says, never the internal "pending". void / draft / scheduled
 * / claimed as stored; paid; "overdue" for an open invoice past due (the
 * `isOverdue` rule, so it agrees with `urgency`); "partly paid" for an open
 * one not yet due with money on it (REQ-1073: `isPartlyPaid`); otherwise the
 * stored status ("sent") — a "pending" with nothing paid on it (every payment
 * deleted) is an open, sent bill.
 */
export function invoiceDisplayStatus(
  invoice: InvoiceStatusInput,
  now: Date,
): string {
  const status = invoice.status ?? "draft";
  if (status === "void") return "void";
  if (status === "paid" || invoice.paidAt) return "paid";
  if (KEPT.has(status)) return status;
  if (isInvoiceOverdue(invoice, now)) return "overdue";
  if (isPartlyPaid(invoice)) return "partly paid";
  return status === "pending" ? "sent" : status;
}
