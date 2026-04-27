import type { Invoice } from "@paperwork/dto/invoice.ts";

export function balanceDue(
  invoice: Pick<Invoice, "amount">,
  paymentsTotal: number,
): number {
  const total = invoice.amount ?? 0;
  return Math.max(0, total - paymentsTotal);
}
