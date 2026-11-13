import { type Lang, t } from "@core/i18n/mod.ts";
import { parseSendInvoiceAsk } from "@agents/domain/business/chat-billing-intent/mod.ts";

/**
 * REQ-456 (demo-loop cycle 3, M25) — what a chat change order's reply says
 * about its delivery to the CUSTOMER. SendChangeOrderAlert emails and texts
 * the customer the /co approval link; the reply used to say only "I've sent
 * you the link to share", which read as if nothing went to the customer.
 *
 * The wording follows the quote send divider (sendQuote.divider.*): a
 * channel that reached the customer names the address, a channel that was
 * tried and failed names its reason, a channel with nothing on file is not
 * mentioned. Nothing delivered → says so and points at the approval link.
 */
export interface ChangeOrderSentInput {
  /** "CO-001" */
  number: string;
  /** The customer's name (or "the customer"). */
  name: string;
  emailedTo?: string;
  textedTo?: string;
  emailFailureReason?: string;
  smsFailureReason?: string;
  /** The alert itself failed (threw) — nothing is known to have gone out. */
  error?: string;
}

export function changeOrderSentLine(
  lang: Lang,
  o: ChangeOrderSentInput,
): string {
  const base = { number: o.number, name: o.name };
  const noRecipient = t(lang, "sendQuote.divider.noRecipient");
  const emailReason = readable(lang, o.emailFailureReason, noRecipient);
  const smsReason = readable(lang, o.smsFailureReason, noRecipient);
  const k = "chatCoordinator.changeOrder.sent";

  if (o.error) {
    return t(lang, `${k}.failed`, { ...base, reason: o.error });
  }
  if (o.emailedTo && o.textedTo) {
    return t(lang, `${k}.emailedAndTexted`, {
      ...base,
      emailedTo: o.emailedTo,
      textedTo: o.textedTo,
    });
  }
  if (o.emailedTo) {
    return smsReason
      ? t(lang, `${k}.emailedTextFailed`, {
        ...base,
        emailedTo: o.emailedTo,
        reason: smsReason,
      })
      : t(lang, `${k}.emailed`, { ...base, emailedTo: o.emailedTo });
  }
  if (o.textedTo) {
    return emailReason
      ? t(lang, `${k}.textedEmailFailed`, {
        ...base,
        textedTo: o.textedTo,
        reason: emailReason,
      })
      : t(lang, `${k}.texted`, { ...base, textedTo: o.textedTo });
  }
  if (emailReason || smsReason) {
    return t(lang, `${k}.notDelivered`, {
      ...base,
      emailReason: emailReason ?? noRecipient,
      smsReason: smsReason ?? noRecipient,
    });
  }
  return t(lang, `${k}.noContact`, base);
}

/** REQ-276 parity: a dispatcher's developer "no recipient: pass `to` …"
 *  reads as the localized "no recipient". REQ-588 (cycle 4, M29): a reason
 *  that is an SMS lang key ("sms.fictionalNumber") is worded, never raw. */
function readable(
  lang: Lang,
  reason: string | undefined,
  noRecipient: string,
): string | undefined {
  const r = reason?.trim();
  if (!r) return undefined;
  if (/^no recipient\b/.test(r)) return noRecipient;
  return /^sms\.[\w.]+$/.test(r) ? t(lang, r) : r;
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
