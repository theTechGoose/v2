import { type Lang, t } from "@core/i18n/mod.ts";
import { parseSendInvoiceAsk } from "@agents/domain/business/chat-billing-intent/mod.ts";
import {
  type ChangeOrderSentInput,
  changeOrderSentLineWith,
} from "#documents/change-order-sent-line.ts";

/**
 * REQ-456 (demo-loop cycle 3, M25) — what a chat change order's reply says
 * about its delivery to the CUSTOMER. SendChangeOrderAlert emails and texts
 * the customer the /co approval link; the reply used to say only "I've sent
 * you the link to share", which read as if nothing went to the customer.
 *
 * REQ-684 (cycle 5, m39): the wording lives in
 * shared/documents/change-order-sent-line.ts so the hand-made change order
 * on /quotes says the very same line.
 */
export type { ChangeOrderSentInput };

export function changeOrderSentLine(
  lang: Lang,
  o: ChangeOrderSentInput,
): string {
  return changeOrderSentLineWith((key, vars) => t(lang, key, vars), o);
}

// ---------------------------------------------------------------------------
// REQ-652 (demo-loop cycle 5, M8) — "Make a change order …" MAKES it. The
// customer is emailed and texted only when the contractor says so: "… and
// send it to her", "email it to Dana", "mándasela", or the reply's Send
// button. The demo's plain "make" / "add" asks went straight to the customer.
// The cues are parseSendInvoiceAsk's (REQ-583), so "send it" means the same
// thing for an invoice and a change order — including "not yet" / "later".
// ---------------------------------------------------------------------------

const CO_NUMBER_RE = /(?<![\p{L}\d-])CO-\d+(?!\d)/iu;

/** "Send CO-002" / "Enviar CO-002" (the Send button's words) and a whole-
 *  message "send it (to her)". Undefined for anything else. */
export function parseSendChangeOrderAsk(
  text: string,
): { changeOrderNumber?: string } | undefined {
  const s = (text ?? "").trim();
  if (!s) return undefined;
  const num = s.match(CO_NUMBER_RE)?.[0]?.toUpperCase();
  // the number is the "it" (dropped: "Send CO-002" reads as "Send");
  // Spanish infinitives read as the imperative
  const asIt = s.replace(CO_NUMBER_RE, " ").replace(/\s{2,}/g, " ").trim()
    .replace(/^(\s*)enviar(?!\p{L})/iu, "$1envía")
    .replace(/^(\s*)mandar(?!\p{L})/iu, "$1manda");
  const ask = parseSendInvoiceAsk(asIt);
  if (!ask || ask.invoiceNumber) return undefined;
  return num ? { changeOrderNumber: num } : {};
}

/** Clauses of a message: sentences, and "… and send it" / "… y mándasela". */
function clauses(text: string): string[] {
  return (text ?? "")
    .split(/[.;:!?\n]+|,|\s+(?:and|then|y|e|luego)\s+/iu)
    .map((c) => c.trim())
    .filter(Boolean);
}

/** True when the message that made the change order also says to send it. */
export function asksToSendChangeOrder(text: string): boolean {
  return clauses(text).some((c) => parseSendChangeOrderAsk(c) !== undefined);
}

/** A thread message, as far as the offer needs it. */
export interface ChangeOrderOfferMessage {
  role: string;
  kind: string;
  payload?: Record<string, unknown> | unknown;
}

/** The change order the reply to the latest message made and did NOT send
 *  (`sent: false`), or undefined — an older reply is not what "it" means. */
export function liveUnsentChangeOrder(
  earlier: readonly ChangeOrderOfferMessage[],
): { changeOrderId: string; number?: string } | undefined {
  let lastUser = -1;
  earlier.forEach((m, i) => {
    if (m.role === "user") lastUser = i;
  });
  for (let i = earlier.length - 1; i > lastUser; i--) {
    const m = earlier[i];
    if (m.role !== "assistant") continue;
    const p = (m.payload ?? {}) as Record<string, unknown>;
    const co = p.changeOrder as Record<string, unknown> | undefined;
    if (!co || co.kind !== "change_order" || co.sent !== false) continue;
    if (typeof co.changeOrderId !== "string" || !co.changeOrderId) continue;
    return {
      changeOrderId: co.changeOrderId,
      ...(typeof co.changeOrderNumber === "string" && co.changeOrderNumber
        ? { number: co.changeOrderNumber }
        : {}),
    };
  }
  return undefined;
}
