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
 *
 * REQ-583 (demo-loop cycle 4, M2): an invoice not sent yet (scheduled /
 * drafted) is shown with "Send now" — pair 3's "Invoice Maria for the deep
 * clean" got "…it's scheduled for Nov 19" and nothing to press. The button
 * posts its own words ("Send INV-001 now"), which the server reads as the
 * send. The card's chip speaks invoice states (Scheduled, Paid), never the
 * quote card's "Draft".
 */
import { cardChipKey } from "./quote-lock.ts";

/** The fields of a chat card's payload these helpers read. */
export interface ChatCardPayload {
  actionType?: unknown;
  invoiceId?: unknown;
  /** REQ-583: the invoice's number ("INV-001"). */
  number?: unknown;
  status?: unknown;
  /** REQ-583: set by the server on an invoice not sent yet. */
  offerSend?: unknown;
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

/** REQ-583: an invoice that has not gone out yet. */
const UNSENT = new Set(["scheduled", "draft"]);

/** A string field of the payload, trimmed; "" when absent. */
function textOf(payload: unknown, key: keyof ChatCardPayload): string {
  const v = fieldOf(payload, key);
  return typeof v === "string" ? v.trim() : "";
}

/**
 * REQ-583 (demo-loop cycle 4, M2): the invoice an invoice card offers to
 * send now — the server flagged it (`offerSend`), it is not sent yet
 * (scheduled / drafted) and carries its number — or null. `later` is every
 * message payload after this card: a later card for the same invoice (sent,
 * or offered again) retires this one's button.
 */
export function invoiceCardSendOffer(
  payload: unknown,
  later: readonly unknown[],
): { invoiceId: string; number: string } | null {
  if (!isInvoiceCardPayload(payload)) return null;
  if (fieldOf(payload, "offerSend") !== true) return null;
  if (!UNSENT.has(textOf(payload, "status").toLowerCase())) return null;
  const invoiceId = textOf(payload, "invoiceId");
  const number = textOf(payload, "number");
  if (!invoiceId || !number) return null;
  const retired = later.some((p) =>
    isInvoiceCardPayload(p) && textOf(p, "invoiceId") === invoiceId
  );
  return retired ? null : { invoiceId, number };
}

/**
 * REQ-583: the i18n key for an invoice card's status chip — the invoice
 * states (Scheduled, Draft, Paid, Payment claimed, Void); sent and viewed
 * read as the quote card's do.
 */
export function invoiceCardChipKey(status: string | undefined | null): string {
  const s = (status ?? "").toLowerCase();
  switch (s) {
    case "scheduled":
    case "draft":
    case "paid":
    case "claimed":
    case "void":
      return `invoices.state.${s}`;
    case "pending":
      return "status.sent";
    default:
      return cardChipKey(s || "sent");
  }
}
