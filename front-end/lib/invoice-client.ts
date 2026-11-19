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

/** REQ-1138 (LOOP-007 q3, q3-69): the invoice's customer id only while that customer is on file.
 *  A deleted customer (REQ-802 soft delete) leaves the live list; her open invoice keeps the id, and
 *  a card that linked or PUT to /customers/<that id> led to "Customer not found". Gone → null, so
 *  the card falls back to the invoice's own bill-to (name from customerSnapshot, REQ-988). */
export function liveCustomerId(
  inv: { customerId?: string | null },
  customers: { has(id: string): boolean },
): string | null {
  return inv.customerId && customers.has(inv.customerId)
    ? inv.customerId
    : null;
}
