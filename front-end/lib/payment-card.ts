/**
 * REQ-555 (demo-loop cycle 4, M24): where a /payments card's actions go.
 * A payment always belongs to an invoice; the paid invoice's public page
 * (/i/<id>) is its receipt (it shows the paid stamp and the received note),
 * and /invoices?open=<id> is the contractor's own detail for that invoice.
 */
export function paymentCardLinks(
  invoiceId: string,
): { receipt: string; invoice: string } {
  const id = encodeURIComponent(invoiceId);
  return { receipt: `/i/${id}`, invoice: `/invoices?open=${id}` };
}

/** The front CTA: a landed card's "View receipt" opens the receipt; an
 *  in-transit card's "View timeline" opens the invoice detail. */
export function paymentCardCtaHref(
  status: string,
  invoiceId: string,
): string {
  const links = paymentCardLinks(invoiceId);
  return status === "landed" ? links.receipt : links.invoice;
}
