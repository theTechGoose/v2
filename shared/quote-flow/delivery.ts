/**
 * REQ-236 (demo M8): the delivery outcome of a quote send, stored on the
 * quote so every surface (the /quotes stage, the pipeline counts, the chat
 * header and thread list) can tell "sent" from "tried to send and failed".
 *
 * `lastDelivery` is the latest attempt; `deliveredAt` is the first time any
 * channel actually delivered. A quote is UNDELIVERED when its latest attempt
 * reached nobody and no attempt ever did.
 */

export type DeliveryChannel = "email" | "sms" | "both";

export interface QuoteDelivery {
  /** ISO time of the attempt. */
  at: string;
  channel: DeliveryChannel;
  emailedTo?: string;
  textedTo?: string;
  emailFailureReason?: string;
  smsFailureReason?: string;
  /** REQ-586 (demo-loop cycle 4, M11): the language the document went out
   *  in — the in-app customer links ("Open as customer", "Copy") carry it as
   *  `?lang=`, like the links inside the SMS / email do (REQ-342). Recorded
   *  on failed attempts too: the link is the fallback then. */
  lang?: "en" | "es";
}

/** True when at least one channel of this attempt delivered. */
export function deliverySucceeded(
  d: QuoteDelivery | null | undefined,
): boolean {
  return !!d && (!!d.emailedTo || !!d.textedTo);
}

/**
 * REQ-572 (demo-loop cycle 4, p4-p7c): how a quote went out when no channel
 * of ours carried it — the owner copied the link, shared it themselves and
 * pressed "Mark as sent". The one non-delivery way a quote becomes sent
 * (amends REQ-236 / REQ-480).
 */
export type SentVia = "link";
export const SENT_VIA_VALUES: readonly SentVia[] = ["link"];

/** A quote whose last send reached nobody and that was never delivered.
 *  REQ-572: a quote the owner marked shared by link is not — they sent it. */
export function isUndelivered(
  q: {
    lastDelivery?: QuoteDelivery | null;
    deliveredAt?: string | null;
    sentVia?: string | null;
  },
): boolean {
  if (q.sentVia === "link") return false;
  if (!q.lastDelivery) return false;
  if (q.deliveredAt) return false;
  return !deliverySucceeded(q.lastDelivery);
}

/**
 * Lift a delivery outcome off a SendQuote `phase_divider` payload. Only a
 * send divider (one that names its quote and carries an outcome) counts;
 * wizard phase dividers return undefined.
 */
export function deliveryFromDivider(
  p: Record<string, unknown> | null | undefined,
  at: string = new Date().toISOString(),
): QuoteDelivery | undefined {
  if (!p || typeof p.quoteId !== "string") return undefined;
  const str = (k: string) =>
    typeof p[k] === "string" && p[k] ? (p[k] as string) : undefined;
  const emailedTo = str("emailedTo");
  const textedTo = str("textedTo");
  const emailFailureReason = str("emailFailureReason");
  const smsFailureReason = str("smsFailureReason");
  if (!emailedTo && !textedTo && !emailFailureReason && !smsFailureReason) {
    return undefined;
  }
  const ch = p.channel;
  const channel: DeliveryChannel = ch === "email" || ch === "sms" ||
      ch === "both"
    ? ch
    : (emailedTo || emailFailureReason) && (textedTo || smsFailureReason)
    ? "both"
    : textedTo || smsFailureReason
    ? "sms"
    : "email";
  return {
    at,
    channel,
    ...(emailedTo ? { emailedTo } : {}),
    ...(textedTo ? { textedTo } : {}),
    ...(emailFailureReason ? { emailFailureReason } : {}),
    ...(smsFailureReason ? { smsFailureReason } : {}),
    // REQ-586: the send's language rides along to the local quote.
    ...(p.lang === "en" || p.lang === "es" ? { lang: p.lang } : {}),
  };
}
