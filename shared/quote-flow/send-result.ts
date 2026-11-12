/**
 * Honest send-result interpretation (P-09): the send endpoints report
 * logical failure as HTTP 200 + {ok:false, reason}, so every send surface
 * must interpret the BODY, never just Response.ok. Maps failures to the
 * same lang keys the honest assistant send divider already uses
 * (sendQuote.divider.noEmail / sendQuote.divider.emailFailed).
 */

export type SendReason = "noEmail" | "noPhone" | "bounced" | "http" | "unknown";

export interface SendOutcome {
  delivered: boolean;
  reason?: SendReason;
}

function classifyReason(reason: unknown): SendReason {
  const text = typeof reason === "string" ? reason.toLowerCase() : "";
  if (text.includes("bounce")) return "bounced";
  if (text.includes("email")) return "noEmail";
  if (text.includes("phone")) return "noPhone";
  return "unknown";
}

/**
 * Interpret a send endpoint response. An {ok:false} body is a failure even
 * on HTTP 200; a 200 body with no explicit ok flag keeps legacy success
 * semantics (PublicQuoteActions parity).
 */
export function interpretSendResult(
  input: { httpOk: boolean; body: unknown },
): SendOutcome {
  if (!input.httpOk) return { delivered: false, reason: "http" };

  const body = input.body as { ok?: unknown; reason?: unknown } | null;
  if (body && typeof body === "object" && body.ok === false) {
    return { delivered: false, reason: classifyReason(body.reason) };
  }
  return { delivered: true };
}

/** The honest divider lang key for a failure; null when delivered. */
export function sendResultLangKey(outcome: SendOutcome): string | null {
  if (outcome.delivered) return null;
  return outcome.reason === "noEmail"
    ? "sendQuote.divider.noEmail"
    : "sendQuote.divider.emailFailed";
}

export type DispatchChannel = "email" | "text";

export interface DispatchSummary {
  /** At least one channel delivered. */
  delivered: boolean;
  /** Delivered on one channel but not the other — say so, never reload as
   *  if everything went (REQ-030 / NW-25). */
  partial: boolean;
  failedChannels: DispatchChannel[];
}

/** REQ-030 (NW-25): the per-channel verdict of a two-channel dispatch. */
export function summarizeDispatch(
  input: { email: SendOutcome; text: SendOutcome },
): DispatchSummary {
  const failedChannels: DispatchChannel[] = [];
  if (!input.email.delivered) failedChannels.push("email");
  if (!input.text.delivered) failedChannels.push("text");
  const delivered = failedChannels.length < 2;
  return {
    delivered,
    partial: delivered && failedChannels.length > 0,
    failedChannels,
  };
}

/** One channel's result as the invoice page holds it: the interpreted
 *  outcome plus the backend's own (already translated) reason. */
export interface ChannelResult {
  outcome: SendOutcome;
  rawReason?: string;
}

export type Translate = (
  key: string,
  params?: Record<string, string>,
) => string;

/** The send endpoints' "nothing to send to" reason ("no recipient: …"), or no
 *  reason at all on a missing-contact verdict. Anything else is a real
 *  failure whose reason the contractor must read — the 555 reason mentions
 *  "email", so the classified reason alone can't tell these apart. */
function missingRecipient(r: ChannelResult): boolean {
  if (r.rawReason) return /^no recipient\b/i.test(r.rawReason.trim());
  return r.outcome.reason === "noEmail" || r.outcome.reason === "noPhone";
}

/**
 * REQ-480 (demo-loop cycle 3, M18): the invoice's own "not delivered" copy
 * for a dispatch where NO channel delivered — never the quote divider's
 * "Quote + Agreement drafted …" wording, and never dropping either channel's
 * reason: "INV-002 not delivered — no email on file; the text failed: …".
 * `keptDraft` adds that the invoice stays a draft until it reaches the client.
 */
export function invoiceNotDeliveredCopy(
  t: Translate,
  input: {
    number?: string;
    email: ChannelResult;
    text: ChannelResult;
    keptDraft?: boolean;
  },
): string {
  const reasonOf = (r: ChannelResult) =>
    r.rawReason ?? r.outcome.reason ?? "unknown";
  const emailPart = missingRecipient(input.email)
    ? t("invoicesPage.send.noEmailOnFile")
    : t("invoicesPage.send.emailFailedReason", {
      reason: reasonOf(input.email),
    });
  const textPart = missingRecipient(input.text)
    ? t("invoicesPage.send.noPhoneOnFile")
    : t("invoicesPage.send.textFailedReason", { reason: reasonOf(input.text) });
  const copy = t("invoicesPage.send.notDelivered", {
    number: input.number?.trim() || t("invoicesPage.send.invoiceFallback"),
    emailPart,
    textPart,
  });
  return input.keptDraft
    ? `${copy}. ${t("invoicesPage.send.keptDraft")}`
    : copy;
}
