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
 *  send history never do — the copy is a brand-new draft with its own number. */
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
  "dueDate",
  "installmentIndex",
  "installmentTotal",
] as const;

export function duplicateDraftOf(
  inv: Record<string, unknown> & { id: string },
): Record<string, unknown> & { status: "draft"; replaces: string } {
  const out: Record<string, unknown> = {};
  for (const k of COPY_FIELDS) {
    if (inv[k] !== undefined && inv[k] !== null) {
      out[k] = structuredClone(inv[k]);
    }
  }
  return { ...out, status: "draft", replaces: inv.id };
}
