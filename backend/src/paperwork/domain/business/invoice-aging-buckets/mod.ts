import type { Invoice } from "@paperwork/dto/invoice.ts";
import { isOverdue } from "@paperwork/domain/business/invoice-aging/mod.ts";

export interface AgingBuckets {
  /** Pending, due in the future. */
  current: number;
  /** Overdue by 1–14 days. */
  aging1_14d: number;
  /** Overdue by 15–30 days. */
  overdue15_30d: number;
  /** Overdue by more than 30 days. */
  overdue30plus: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Group pending invoices into aging cohorts for the dashboard money roll-up.
 *
 * Paid invoices are ignored. The "current" bucket holds pending invoices
 * whose dueDate is today or later; the three overdue buckets partition
 * everything that's `isOverdue()`.
 */
export function bucketPendingInvoices(
  invoices: Pick<Invoice, "dueDate" | "status" | "paidAt">[],
  now: Date,
): AgingBuckets {
  const buckets: AgingBuckets = { current: 0, aging1_14d: 0, overdue15_30d: 0, overdue30plus: 0 };
  for (const inv of invoices) {
    if (inv.status === "paid" || inv.paidAt) continue;
    if (!isOverdue(inv, now)) {
      buckets.current += 1;
      continue;
    }
    const daysOverdue = Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / MS_PER_DAY);
    if (daysOverdue <= 14) buckets.aging1_14d += 1;
    else if (daysOverdue <= 30) buckets.overdue15_30d += 1;
    else buckets.overdue30plus += 1;
  }
  return buckets;
}
