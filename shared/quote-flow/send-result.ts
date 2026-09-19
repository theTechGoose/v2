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
