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

/**
 * REQ-926 — Raphael: "lets remove the in transit, add to the payment a
 * 'chargeback' button." A recorded payment is landed at once (the old
 * method-and-age "In transit" is gone); a charged-back one is reversed.
 */
export type PaymentCardStatus = "landed" | "reversed";

export function paymentStatus(
  p: { method?: string; reversedAt?: string | null },
): PaymentCardStatus {
  return p.reversedAt ? "reversed" : "landed";
}

/** REQ-926: the chargeback modal's fee box starts on Settings' default —
 *  dollars, "" when there is none. */
export function chargebackFeeDollars(
  identity: { chargebackFeeCents?: number | null } | null | undefined,
): string {
  const c = identity?.chargebackFeeCents ?? 0;
  return c > 0 ? (c / 100).toFixed(2) : "";
}

/** REQ-926: typed dollars → whole cents ("" = 0); null when not a number ≥ 0. */
export function parseChargebackFee(raw: string): number | null {
  const t = raw.trim().replace(/^\$/, "").replace(/,/g, "").trim();
  if (t === "") return 0;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}
