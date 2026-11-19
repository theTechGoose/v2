/**
 * REQ-696 (demo-loop cycle 5, M22) — whom an invoice bills, as the /invoices
 * list names it: the customer on file, else the typed BILL TO name (then its
 * business name), else "—". An invoice issued with only a bill-to name
 * ("Sin cliente", BILL TO Jorge Ruiz) used to read "—" in the list while its
 * public page said "FACTURAR A Jorge Ruiz".
 *
 * REQ-988 (LOOP-007 q1, q1-71) — then the customerSnapshot the invoice took
 * when it was issued (name, then business name): a deleted customer (soft
 * delete, REQ-802) leaves the live map, and the invoice used to read "—".
 */
export interface InvoiceClientFields {
  customerId?: string;
  billTo?: { name?: string; businessName?: string };
  customerSnapshot?: { name?: string; businessName?: string } | null;
}

export function invoiceClientName(
  inv: InvoiceClientFields,
  customers: ReadonlyMap<string, string>,
): string {
  const onFile = inv.customerId ? customers.get(inv.customerId) : undefined;
  return [
    onFile,
    inv.billTo?.name,
    inv.billTo?.businessName,
    inv.customerSnapshot?.name,
    inv.customerSnapshot?.businessName,
  ]
    .map((s) => s?.trim())
    .find((s) => !!s) ?? "—";
}
