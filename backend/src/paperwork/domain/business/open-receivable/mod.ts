import type { Invoice } from "@paperwork/dto/invoice.ts";

/**
 * REQ-397 (demo-loop cycle 2, M14) — the ONE rule for "money a customer owes
 * right now". Every roll-up that says outstanding / owed / next due reads it
 * (dashboard stats + aging buckets, active jobs, customer cards).
 *
 * The lifecycle is scheduled|draft|sent|viewed|claimed|paid|void
 * (dto/invoice.ts). An invoice is owed once it is in front of the customer
 * (sent / viewed / claimed) and until it is paid; `pending` is the legacy
 * name ComputeInvoiceBalance still writes for a partly paid invoice, so it
 * stays owed too. A `scheduled` installment is upcoming (not billed yet) —
 * see `isUpcomingReceivable`; draft and void are never owed.
 */
export const OPEN_RECEIVABLE_STATUSES: ReadonlySet<string> = new Set([
  "sent",
  "viewed",
  "claimed",
  "pending",
]);

type ReceivableFields = Pick<Invoice, "status" | "amount" | "paidAt"> & {
  paidCents?: number | null;
};

/** What is still owed on the invoice, INTEGER CENTS: amount − paid, ≥ 0. */
export function receivableBalanceCents(
  inv: Pick<Invoice, "amount"> & { paidCents?: number | null },
): number {
  return Math.max(0, (inv.amount ?? 0) - (inv.paidCents ?? 0));
}

/** Out with the customer, unpaid, with money still owed on it. */
export function isOpenReceivable(inv: ReceivableFields): boolean {
  if (!OPEN_RECEIVABLE_STATUSES.has(inv.status ?? "")) return false;
  if (inv.paidAt) return false;
  return receivableBalanceCents(inv) > 0;
}

/** A scheduled installment of a signed job — money to bill later. */
export function isUpcomingReceivable(inv: ReceivableFields): boolean {
  return inv.status === "scheduled" && !inv.paidAt &&
    receivableBalanceCents(inv) > 0;
}
