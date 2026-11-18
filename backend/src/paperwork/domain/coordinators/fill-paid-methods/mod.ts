/**
 * REQ-928 — an invoice paid before `paidMethods` existed still says how it
 * was paid: on read, a paid invoice with no recorded methods takes them from
 * its payment rows (one payments read per owner, only when one is missing).
 * Read-only — the balance coordinator stays the only writer.
 */
import type { Invoice } from "@paperwork/dto/invoice.ts";
import type { PaymentStore } from "@paperwork/domain/data/payment-store/mod.ts";
import { paidMethodsOf } from "#documents/paid-how.ts";

const isPaid = (i: Invoice) => i.status === "paid" || !!i.paidAt;

export async function fillPaidMethods<T extends Invoice>(
  payments: Pick<PaymentStore, "listByUser">,
  list: T[],
): Promise<T[]> {
  const owners = [
    ...new Set(
      list.filter((i) => isPaid(i) && !i.paidMethods?.length).map((i) =>
        i.userId
      ),
    ),
  ];
  if (owners.length === 0) return list;
  const byInvoice = new Map<
    string,
    { method?: string; receivedAt?: string }[]
  >();
  for (const owner of owners) {
    const rows = await payments.listByUser(owner).catch(() => []);
    for (const p of rows) {
      const arr = byInvoice.get(p.invoiceId) ?? [];
      arr.push(p);
      byInvoice.set(p.invoiceId, arr);
    }
  }
  return list.map((i) => {
    if (!isPaid(i) || i.paidMethods?.length) return i;
    const rows = byInvoice.get(i.id);
    return rows?.length ? { ...i, paidMethods: paidMethodsOf(rows) } : i;
  });
}
