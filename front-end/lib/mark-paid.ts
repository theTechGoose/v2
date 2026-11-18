/**
 * REQ-930: the request behind MarkPaidDialog's "Mark as paid" — POST
 * /invoices/:id/confirm-payment with the reference the owner typed (the
 * server trims it; empty records none).
 */
export function confirmPaymentInit(reference: string): RequestInit {
  return {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reference }),
  };
}
