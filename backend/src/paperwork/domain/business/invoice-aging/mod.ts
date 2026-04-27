import type { Invoice } from "@paperwork/dto/invoice.ts";

export function isOverdue(
  invoice: Pick<Invoice, "dueDate" | "status" | "paidAt">,
  now: Date,
): boolean {
  if (invoice.paidAt) return false;
  if (invoice.status === "paid") return false;
  return new Date(invoice.dueDate).getTime() < now.getTime();
}
