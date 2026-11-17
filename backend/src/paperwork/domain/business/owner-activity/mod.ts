/**
 * REQ-566 (demo-loop cycle 4, m11) — the owner's own work, as bus events.
 *
 * The dashboard's "What we handled today" reads the notifications feed
 * (REQ-299), and NotifyOnEvent only ever saw customer-side events. These
 * build the events for an invoice the owner issued and a payment the owner
 * recorded, so every path that does either emits the same shape.
 */
import type { DomainEvent } from "@core/business/events/mod.ts";

type BusEvent = Omit<DomainEvent, "timestamp">;

/** An invoice moves from unissued (draft / scheduled / not yet stored) to
 *  issued. Void and paid are not "sent to the client". */
export function isIssuingTransition(
  before: string | undefined,
  after: string | undefined,
): boolean {
  const unissued = before === undefined || before === "draft" ||
    before === "scheduled";
  return unissued && (after === "sent" || after === "viewed");
}

/** `invoice:issued` — the feed says "Invoice for $450 sent to Bob Smith". */
export function invoiceIssuedEvent(
  userId: string,
  invoice: { id: string; amount?: number | null },
  customerName?: string,
): BusEvent {
  return {
    userId,
    entityType: "invoice",
    entityId: invoice.id,
    action: "issued",
    data: {
      ...(typeof invoice.amount === "number"
        ? { amountCents: invoice.amount }
        : {}),
      ...(customerName ? { customerName } : {}),
    },
  };
}

/** `invoice:payment_recorded` — the owner logged money received. */
export function paymentRecordedEvent(
  userId: string,
  payment: { invoiceId: string; amount: number; method: string },
  customerName?: string,
): BusEvent {
  return {
    userId,
    entityType: "invoice",
    entityId: payment.invoiceId,
    action: "payment_recorded",
    data: {
      amountCents: payment.amount,
      method: payment.method,
      ...(customerName ? { customerName } : {}),
    },
  };
}
