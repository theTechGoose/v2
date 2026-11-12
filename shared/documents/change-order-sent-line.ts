/**
 * REQ-456 (cycle 3, M25) + REQ-684 (cycle 5, m39) — the ONE line that says
 * what a change order's alert delivered to the CUSTOMER, for both the chat
 * reply and the hand-made change order on /quotes.
 *
 * The wording follows the quote send divider (sendQuote.divider.*): a
 * channel that reached the customer names the address, a channel that was
 * tried and failed names its reason, a channel with nothing on file is not
 * mentioned. Nothing delivered → says so and points at the approval link.
 *
 * Pure, with the translator injected: the backend passes its `t(lang, …)`,
 * the front end its `tFor(lang, …)` — the same lang/*.json keys either way.
 */

export type Translate = (
  key: string,
  vars?: Record<string, string | number>,
) => string;

/** What reached the customer, per channel (the alert's facts, wire-safe). */
export interface ChangeOrderDelivery {
  emailedTo?: string;
  textedTo?: string;
  emailFailureReason?: string;
  smsFailureReason?: string;
  /** The alert itself failed (threw / no contractor) — nothing is known to have gone out. */
  error?: string;
}

export interface ChangeOrderSentInput extends ChangeOrderDelivery {
  /** "CO-001" */
  number: string;
  /** The customer's name (or "the customer"). */
  name: string;
}

/** REQ-684: the alert's result (or its thrown error) as the response's
 *  `delivery` — the per-channel facts only, never number/approvalPath. */
export function changeOrderDeliveryOf(
  result:
    | { ok?: boolean; reason?: string; customer?: ChangeOrderDelivery }
    | undefined,
  error?: string,
): ChangeOrderDelivery {
  const c = result?.customer;
  if (!c) return { error: error ?? result?.reason ?? "not sent" };
  const out: ChangeOrderDelivery = {};
  if (c.emailedTo) out.emailedTo = c.emailedTo;
  if (c.textedTo) out.textedTo = c.textedTo;
  if (c.emailFailureReason) out.emailFailureReason = c.emailFailureReason;
  if (c.smsFailureReason) out.smsFailureReason = c.smsFailureReason;
  return out;
}

export function changeOrderSentLineWith(
  t: Translate,
  o: ChangeOrderSentInput,
): string {
  const base = { number: o.number, name: o.name };
  const noRecipient = t("sendQuote.divider.noRecipient");
  const emailReason = readable(t, o.emailFailureReason, noRecipient);
  const smsReason = readable(t, o.smsFailureReason, noRecipient);
  const k = "chatCoordinator.changeOrder.sent";

  if (o.error) {
    return t(`${k}.failed`, { ...base, reason: o.error });
  }
  if (o.emailedTo && o.textedTo) {
    return t(`${k}.emailedAndTexted`, {
      ...base,
      emailedTo: o.emailedTo,
      textedTo: o.textedTo,
    });
  }
  if (o.emailedTo) {
    return smsReason
      ? t(`${k}.emailedTextFailed`, {
        ...base,
        emailedTo: o.emailedTo,
        reason: smsReason,
      })
      : t(`${k}.emailed`, { ...base, emailedTo: o.emailedTo });
  }
  if (o.textedTo) {
    return emailReason
      ? t(`${k}.textedEmailFailed`, {
        ...base,
        textedTo: o.textedTo,
        reason: emailReason,
      })
      : t(`${k}.texted`, { ...base, textedTo: o.textedTo });
  }
  if (emailReason || smsReason) {
    return t(`${k}.notDelivered`, {
      ...base,
      emailReason: emailReason ?? noRecipient,
      smsReason: smsReason ?? noRecipient,
    });
  }
  return t(`${k}.noContact`, base);
}

/** REQ-276 parity: a dispatcher's developer "no recipient: pass `to` …"
 *  reads as the localized "no recipient". REQ-588 (cycle 4, M29): a reason
 *  that is an SMS lang key ("sms.fictionalNumber") is worded, never raw. */
function readable(
  t: Translate,
  reason: string | undefined,
  noRecipient: string,
): string | undefined {
  const r = reason?.trim();
  if (!r) return undefined;
  if (/^no recipient\b/.test(r)) return noRecipient;
  return /^sms\.[\w.]+$/.test(r) ? t(r) : r;
}
