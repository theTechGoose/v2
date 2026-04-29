import type { Invoice } from "@paperwork/dto/invoice.ts";
import { isOverdue } from "@paperwork/domain/business/invoice-aging/mod.ts";

export const INVOICE_URGENCY = ["paid", "current", "soon", "overdue15d", "overdue30plus"] as const;
export type InvoiceUrgency = typeof INVOICE_URGENCY[number];

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Pending invoices due within this many days (and not yet overdue) project as "soon". */
const SOON_THRESHOLD_DAYS = 7;

/**
 * deriveUrgency — computed mood field for the Invoices page.
 *
 *   paid          → already collected
 *   current       → pending, due > SOON_THRESHOLD_DAYS away
 *   soon          → pending, due within SOON_THRESHOLD_DAYS
 *   overdue15d    → overdue 1–30 days
 *   overdue30plus → overdue more than 30 days (deep-red mood)
 */
export function deriveUrgency(
  invoice: Pick<Invoice, "dueDate" | "status" | "paidAt">,
  now: Date,
): InvoiceUrgency {
  if (invoice.status === "paid" || invoice.paidAt) return "paid";
  if (!isOverdue(invoice, now)) {
    const msUntilDue = new Date(invoice.dueDate).getTime() - now.getTime();
    return msUntilDue <= SOON_THRESHOLD_DAYS * MS_PER_DAY ? "soon" : "current";
  }
  const daysOverdue = Math.floor((now.getTime() - new Date(invoice.dueDate).getTime()) / MS_PER_DAY);
  return daysOverdue > 30 ? "overdue30plus" : "overdue15d";
}
