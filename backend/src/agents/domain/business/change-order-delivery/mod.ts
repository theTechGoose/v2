import { type Lang, t } from "@core/i18n/mod.ts";

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
  /** REQ-681 (cycle 5, m12): the phone on file can't take texts, so no text
   *  was attempted — reported as "not texted: <reason>", never "failed". */
  smsSkippedReason?: string;
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
  const skipReason = readable(lang, o.smsSkippedReason, noRecipient);
  const smsReason = readable(lang, o.smsFailureReason, noRecipient) ??
    skipReason;
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
  if (o.emailedTo && skipReason && !o.smsFailureReason) {
    return t(lang, `${k}.emailedNotTexted`, {
      ...base,
      emailedTo: o.emailedTo,
      reason: skipReason,
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
