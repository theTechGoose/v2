import type { Invoice } from "@paperwork/dto/invoice.ts";
import { isOverdue } from "@paperwork/domain/business/invoice-aging/mod.ts";
import {
  isOpenReceivable,
  receivableBalanceCents,
} from "@paperwork/domain/business/open-receivable/mod.ts";

/** Money still owed, INTEGER CENTS, by how late it is. */
export interface AgingBuckets {
  /** Owed, due today or later. */
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
 * Group open receivables into aging cohorts for the dashboard money roll-up.
 *
 * REQ-397 (demo-loop cycle 2, M14): each bucket is the SUM of the invoices'
 * balances in cents (amount − paid), never a count — the dashboard divides
 * by 100, and counting made two unpaid invoices read "Current $0.02". Only
 * open receivables (`isOpenReceivable`: sent / viewed / claimed / legacy
 * pending, unpaid) are owed; scheduled, draft, paid and void are not.
 */
export function bucketPendingInvoices(
  invoices: Array<
    Pick<Invoice, "dueDate" | "status" | "paidAt" | "amount"> & {
      paidCents?: number | null;
    }
  >,
  now: Date,
): AgingBuckets {
  const buckets: AgingBuckets = { current: 0, aging1_14d: 0, overdue15_30d: 0, overdue30plus: 0 };
  for (const inv of invoices) {
    if (!isOpenReceivable(inv)) continue;
    const cents = receivableBalanceCents(inv);
    if (!isOverdue(inv, now)) {
      buckets.current += cents;
      continue;
    }
    const daysOverdue = Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / MS_PER_DAY);
    if (daysOverdue <= 14) buckets.aging1_14d += cents;
    else if (daysOverdue <= 30) buckets.overdue15_30d += cents;
    else buckets.overdue30plus += cents;
  }
  return buckets;
}
