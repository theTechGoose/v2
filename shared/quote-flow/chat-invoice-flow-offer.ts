/**
 * REQ-656 (demo-loop cycle 5, M9) — "Job done, need to invoice", typed.
 *
 * The assistant's starter chip "Job done, need to invoice." opens the
 * invoice flow on the client (AsstChat `startInvoiceFlow`). Typed, the same
 * words reached the chat model, whose only drafting tool is create_quote:
 * pair 8 got "Q-002 · Cotización redactada" for "Trabajo terminado,
 * necesito facturar: Jorge Ruiz, …, $200". Now the server reads the ask and
 * answers with this offer on its reply's payload (`invoiceFlow`): what the
 * contractor typed, the amount and who to bill. The chat opens the invoice
 * flow from it when the reply arrives, and keeps a "Start the invoice"
 * button on the newest message while no job is bound.
 */

export interface InvoiceFlowOffer {
  /** The contractor's own words — the job details the flow starts from. */
  details: string;
  /** INTEGER CENTS. */
  amountCents?: number;
  customerName?: string;
  customerEmail?: string;
}

/** The offer on a message payload, if it carries a usable one. */
export function invoiceFlowOfferOf(
  payload: unknown,
): InvoiceFlowOffer | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const raw = (payload as { invoiceFlow?: unknown }).invoiceFlow;
  if (!raw || typeof raw !== "object") return undefined;
  const { details, amountCents, customerName, customerEmail } = raw as Record<
    string,
    unknown
  >;
  if (typeof details !== "string" || !details.trim()) return undefined;
  const out: InvoiceFlowOffer = { details: details.trim() };
  if (
    typeof amountCents === "number" && Number.isFinite(amountCents) &&
    amountCents > 0
  ) {
    out.amountCents = Math.round(amountCents);
  }
  if (typeof customerName === "string" && customerName.trim()) {
    out.customerName = customerName.trim();
  }
  if (typeof customerEmail === "string" && customerEmail.trim()) {
    out.customerEmail = customerEmail.trim();
  }
  return out;
}

/** The message fields the rule reads. */
export interface InvoiceFlowOfferMessage {
  id: string;
  role: string;
  kind?: string;
  payload?: unknown;
}

/** The offer still standing: the thread's NEWEST message is the assistant's
 *  reply carrying it, and no job is bound yet (the flow binds one). */
export function liveInvoiceFlowOffer(
  messages: readonly InvoiceFlowOfferMessage[],
  boundQuoteId: string | null | undefined,
): { id: string; offer: InvoiceFlowOffer } | undefined {
  if (boundQuoteId) return undefined;
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant" || (last.kind ?? "text") !== "text") {
    return undefined;
  }
  const offer = invoiceFlowOfferOf(last.payload);
  return offer ? { id: last.id, offer } : undefined;
}

/** The offer a chat reply just brought, among its new messages — what opens
 *  the flow on arrival (an older one, read back from history, never does). */
export function arrivedInvoiceFlowOffer(
  newMessages: readonly InvoiceFlowOfferMessage[],
): InvoiceFlowOffer | undefined {
  for (let i = newMessages.length - 1; i >= 0; i--) {
    const m = newMessages[i];
    if (m.role !== "assistant") continue;
    const offer = invoiceFlowOfferOf(m.payload);
    if (offer) return offer;
  }
  return undefined;
}
