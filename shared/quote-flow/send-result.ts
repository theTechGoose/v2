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

/** REQ-030 (NW-25): the per-channel verdict of a two-channel dispatch.
 *  REQ-727 (cycle 5, c4-M16): a channel the send sheet did not pick is
 *  absent — never tried, so neither a failure nor half of a partial. */
export function summarizeDispatch(
  input: { email?: SendOutcome; text?: SendOutcome },
): DispatchSummary {
  const failedChannels: DispatchChannel[] = [];
  if (input.email && !input.email.delivered) failedChannels.push("email");
  if (input.text && !input.text.delivered) failedChannels.push("text");
  const delivered = !!(input.email?.delivered || input.text?.delivered);
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
  /** REQ-695: the endpoint's machine code — "missing" means there is no
   *  address on file for this channel (both send endpoints set it). */
  failureCode?: string;
  /** REQ-695: never fired — the client has no address for this channel. */
  skipped?: boolean;
}

export type Translate = (
  key: string,
  params?: Record<string, string>,
) => string;

/** The send endpoints' "nothing to send to" reason ("no recipient: …"), or no
 *  reason at all on a missing-contact verdict. Anything else is a real
 *  failure whose reason the contractor must read — the 555 reason mentions
 *  "email", so the classified reason alone can't tell these apart. */
export function missingRecipient(r: ChannelResult): boolean {
  if (r.outcome.delivered) return false;
  if (r.skipped || r.failureCode === "missing") return true;
  if (r.rawReason) return /^no recipient\b/i.test(r.rawReason.trim());
  return r.outcome.reason === "noEmail" || r.outcome.reason === "noPhone";
}

/**
 * REQ-695 (demo-loop cycle 5, M23): why ONE channel did not go, in the
 * contractor's words — "no phone on file" / "no email on file" for a missing
 * recipient (the endpoints' "no recipient: pass `to` …" is a developer
 * string and never shown), else the backend's own translated reason.
 */
export function channelFailReason(
  t: Translate,
  channel: DispatchChannel,
  r: ChannelResult,
): string {
  if (missingRecipient(r)) {
    return t(
      channel === "text"
        ? "invoicesPage.send.noPhoneOnFile"
        : "invoicesPage.send.noEmailOnFile",
    );
  }
  return r.rawReason ?? r.outcome.reason ?? "unknown";
}

export interface InvoiceDispatchSummary extends DispatchSummary {
  /** REQ-695 (m55): neither channel had an address — adding an email or a
   *  phone is the fix (the REQ-401 `noRecipient` verdict). */
  noRecipient: boolean;
}

/**
 * REQ-695 (demo-loop cycle 5, M23 + m55): the invoice dispatch's verdict.
 * A channel the client has no address for (missing, or never fired) is not
 * a failure once the other delivered — a phone-less bill is simply "sent by
 * email", never half-delivered. Both missing is `noRecipient`.
 */
export function summarizeInvoiceDispatch(
  input: { email: ChannelResult; text: ChannelResult },
): InvoiceDispatchSummary {
  const anyDelivered = input.email.outcome.delivered ||
    input.text.outcome.delivered;
  const failedChannels: DispatchChannel[] = [];
  for (const ch of ["email", "text"] as const) {
    const r = input[ch];
    if (r.outcome.delivered) continue;
    if (anyDelivered && missingRecipient(r)) continue;
    failedChannels.push(ch);
  }
  return {
    delivered: anyDelivered,
    partial: anyDelivered && failedChannels.length > 0,
    failedChannels,
    noRecipient: missingRecipient(input.email) &&
      missingRecipient(input.text),
  };
}

/**
 * REQ-030 / REQ-695: the half-delivered sentence — which channel went and
 * why the other did not, through `channelFailReason` (never a raw
 * "no recipient" reason).
 */
export function invoicePartialCopy(
  t: Translate,
  input: { email: ChannelResult; text: ChannelResult },
): string {
  const textFailed = !input.text.outcome.delivered;
  return t(
    textFailed
      ? "invoicesPage.send.partialTextFailed"
      : "invoicesPage.send.partialEmailFailed",
    {
      reason: channelFailReason(
        t,
        textFailed ? "text" : "email",
        textFailed ? input.text : input.email,
      ),
    },
  );
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
    /** REQ-727: absent = not tried (the send sheet picked the other channel) */
    email?: ChannelResult;
    text?: ChannelResult;
    keptDraft?: boolean;
  },
): string {
  const reasonOf = (r: ChannelResult) =>
    r.rawReason ?? r.outcome.reason ?? "unknown";
  const emailPart = (r: ChannelResult) =>
    missingRecipient(r)
      ? t("invoicesPage.send.noEmailOnFile")
      : t("invoicesPage.send.emailFailedReason", { reason: reasonOf(r) });
  const textPart = (r: ChannelResult) =>
    missingRecipient(r)
      ? t("invoicesPage.send.noPhoneOnFile")
      : t("invoicesPage.send.textFailedReason", { reason: reasonOf(r) });
  const number = input.number?.trim() ||
    t("invoicesPage.send.invoiceFallback");
  // REQ-727 (cycle 5, c4-M16): a one-channel send names that channel only.
  const one = input.email && !input.text
    ? emailPart(input.email)
    : input.text && !input.email
    ? textPart(input.text)
    : undefined;
  const copy = one !== undefined
    ? t("invoicesPage.send.notDeliveredOne", { number, part: one })
    : t("invoicesPage.send.notDelivered", {
      number,
      emailPart: emailPart(
        input.email ?? { outcome: { delivered: false, reason: "noEmail" } },
      ),
      textPart: textPart(
        input.text ?? { outcome: { delivered: false, reason: "noPhone" } },
      ),
    });
  return input.keptDraft
    ? `${copy}. ${t("invoicesPage.send.keptDraft")}`
    : copy;
}
