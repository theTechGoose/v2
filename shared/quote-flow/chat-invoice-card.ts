/**
 * REQ-368 (demo-loop cycle 1, M32) — the invoice card in the assistant chat.
 *
 * An action_card is a quote card unless it says otherwise: older threads
 * carry no actionType, and the quote's cards say "quote". An invoice card
 * (actionType "invoice") is the assistant's answer to "send him the deposit
 * invoice" — the invoice signing already sent — and SendInvoice's "sent"
 * card. It links to that invoice and takes none of the quote card's buttons
 * ("Re-open" posted "Re-open the quote." against the signed quote), and the
 * chat's quote reads (send preview, payment-step preview) skip it: its
 * $1,600 is the deposit, not the quote.
 */

/** The fields of a chat card's payload these helpers read. */
export interface ChatCardPayload {
  actionType?: unknown;
  invoiceId?: unknown;
}

/** A payload field, from whatever the message carries (payloads are
 *  untyped JSON). */
function fieldOf(payload: unknown, key: keyof ChatCardPayload): unknown {
  return payload && typeof payload === "object"
    ? (payload as ChatCardPayload)[key]
    : undefined;
}

/** A quote card — "quote", or no actionType at all (older threads). */
export function isQuoteCardPayload(payload: unknown): boolean {
  const type = fieldOf(payload, "actionType");
  return type === "quote" || type == null;
}

/** An invoice card. */
export function isInvoiceCardPayload(payload: unknown): boolean {
  return fieldOf(payload, "actionType") === "invoice";
}

/** Where an invoice card's link goes: that invoice's detail on the Invoices
 *  page (`/invoices?open=<id>`); none for any other card, or without an id. */
export function invoiceCardHref(payload: unknown): string | undefined {
  if (!isInvoiceCardPayload(payload)) return undefined;
  const raw = fieldOf(payload, "invoiceId");
  const id = typeof raw === "string" ? raw.trim() : "";
  return id ? `/invoices?open=${encodeURIComponent(id)}` : undefined;
}
