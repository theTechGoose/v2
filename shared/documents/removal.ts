/**
 * REQ-627 — removing an invoice, with a clear process. Pure; the server
 * enforces it (409 with the reason) and the app shows the one button it allows.
 *
 *   never sent, no payments  → "delete"  (gone for good)
 *   sent, or any payment     → "void"    (stays in the list as Cancelled; the
 *                                         customer's link says so; payments stay)
 *   paid                     → "locked"  (part of the record — neither)
 *   already void             → "none"
 */

import { dueDateFrom } from "./invoice-form.ts";

export type RemovalAction = "delete" | "void" | "locked" | "none";

export interface RemovalDecision {
  action: RemovalAction;
  /** the 409 code the server answers for the action it refuses */
  reason?: "locked_paid" | "already_void";
  hasPayments: boolean;
}

/** The most ids one bulk call (remove, print) takes. */
export const MAX_BULK_IDS = 500;

export function removalFor(
  inv: { status?: string; sentAt?: string; paidCents?: number },
  paymentCount: number,
): RemovalDecision {
  const hasPayments = paymentCount > 0 || (inv.paidCents ?? 0) > 0;
  if (inv.status === "paid") {
    return { action: "locked", reason: "locked_paid", hasPayments };
  }
  if (inv.status === "void") {
    return { action: "none", reason: "already_void", hasPayments };
  }
  const neverSent = (inv.status === undefined || inv.status === "draft" ||
    inv.status === "scheduled") && !inv.sentAt;
  return { action: neverSent && !hasPayments ? "delete" : "void", hasPayments };
}

/** The content a corrected copy carries over. Numbering, status, payment and
 *  send history never do — the copy is a brand-new draft with its own number.
 *  REQ-964: nor does the absolute due date — it is counted again from the day
 *  the copy is made (see duplicateDraftOf). */
const COPY_FIELDS = [
  "customerId",
  "quoteId",
  "jobName",
  "description",
  "lineItems",
  "amount",
  "discountCents",
  "discountReason",
  "subtotalCents",
  "taxRateBp",
  "taxCents",
  "serviceAddress",
  "serviceDateFrom",
  "serviceDateTo",
  "paymentInstructions",
  "billTo",
  "netDays",
  "installmentIndex",
  "installmentTotal",
] as const;

/** REQ-926/964: does an invoice carry a chargeback fee line? */
export function hasChargebackFee(inv: { lineItems?: unknown }): boolean {
  return Array.isArray(inv.lineItems) &&
    inv.lineItems.some((l) =>
      !!l && typeof l === "object" &&
      (l as { chargebackFor?: unknown }).chargebackFor !== undefined
    );
}

const DAY_MS = 86_400_000;

/** whole days from one yyyy-mm-dd to another, or null if either is bad */
function daySpan(from: unknown, to: unknown): number | null {
  if (typeof from !== "string" || typeof to !== "string") return null;
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / DAY_MS);
}

/**
 * REQ-627 "Void & duplicate": a fresh DRAFT with the bill's content.
 *
 * REQ-964 (REQ-627 AMENDMENT, refs REQ-926):
 *  - the due date is counted from `todayIso` — today + netDays, else the
 *    original's own span (due − issued) from today, else left unset (the
 *    store's default) — never the voided bill's stale absolute date, and the
 *    same date Finish + send stamps (REQ-174/554);
 *  - REQ-926 chargeback fee lines (`chargebackFor`) stay on the voided bill
 *    with the payment they belong to, so their cents leave amount/subtotal;
 *    a fee still owed is added back by hand.
 */
export function duplicateDraftOf(
  inv: Record<string, unknown> & { id: string },
  todayIso: string = new Date().toISOString().slice(0, 10),
): Record<string, unknown> & { status: "draft"; replaces: string } {
  const out: Record<string, unknown> = {};
  for (const k of COPY_FIELDS) {
    if (inv[k] !== undefined && inv[k] !== null) {
      out[k] = structuredClone(inv[k]);
    }
  }
  // the due date, counted again from today
  const netDays = typeof inv.netDays === "number" &&
      Number.isFinite(inv.netDays)
    ? inv.netDays
    : daySpan(inv.issuedDate, inv.dueDate);
  if (netDays !== null) {
    out.dueDate = dueDateFrom(todayIso, Math.max(0, netDays));
  }
  // chargeback fee lines (and their cents) stay on the voided bill
  if (Array.isArray(out.lineItems)) {
    const lines = out.lineItems as Array<Record<string, unknown>>;
    const fees = lines.filter((l) =>
      !!l && typeof l === "object" && l.chargebackFor !== undefined
    );
    if (fees.length) {
      const cents = fees.reduce(
        (s, l) =>
          s +
          Math.round(
            (typeof l.price === "number" ? l.price : 0) *
              (typeof l.quantity === "number" ? l.quantity : 1),
          ),
        0,
      );
      out.lineItems = lines.filter((l) => !fees.includes(l));
      if (typeof out.amount === "number") out.amount = out.amount - cents;
      if (typeof out.subtotalCents === "number") {
        out.subtotalCents = out.subtotalCents - cents;
      }
    }
  }
  return { ...out, status: "draft", replaces: inv.id };
}
