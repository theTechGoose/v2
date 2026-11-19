import type { Invoice } from "@paperwork/dto/invoice.ts";
import { isInvoiceOverdue } from "#documents/invoice-status.ts";

/** REQ-966: one overdue rule, shared with the CSV export's Status column. */
export function isOverdue(
  invoice: Pick<Invoice, "dueDate" | "status" | "paidAt">,
  now: Date,
): boolean {
  return isInvoiceOverdue(invoice, now);
}
