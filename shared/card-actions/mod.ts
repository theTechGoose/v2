/**
 * REQ-626 — what each card button does. Pure; the islands wire these.
 */

/** "sms:+15125550101" (the phone first), "mailto:…" otherwise, null with no
 *  contact. A body pre-fills the message (RFC 5724 / RFC 6068 `?body=`). */
export function messageHref(
  c: { phoneNumber?: string | null; email?: string | null },
  body?: string,
): string | null {
  const q = body ? `?body=${encodeURIComponent(body)}` : "";
  const phone = (c.phoneNumber ?? "").trim();
  const digits = phone.replace(/\D/g, "");
  if (digits) {
    const e164 = phone.startsWith("+")
      ? `+${digits}`
      : digits.length === 10
      ? `+1${digits}`
      : digits.length === 11 && digits.startsWith("1")
      ? `+${digits}`
      : digits;
    return `sms:${e164}${q}`;
  }
  const email = (c.email ?? "").trim();
  if (email) return `mailto:${email}${q}`;
  return null;
}

/** The slice of a customer card the CTA reads. `balanceSubParts` is the
 *  card's balance sub-line as data (REQ-367): how due the open money is. */
export interface ClientCtaInput {
  balanceCents: number;
  status: string;
  balanceSubParts?: { kind: string; days?: number } | null;
}

/** REQ-1066 (LOOP-007 q2-56): an invoice due within this many days is close
 *  enough to headline "Send a kind reminder". */
export const REMINDER_DUE_WITHIN_DAYS = 3;

/** REQ-1066 — the card headlines a reminder only for money that is due: an
 *  open balance whose next invoice is overdue, due today, due within
 *  REMINDER_DUE_WITHIN_DAYS, or owed with no due date ("owes", or a card
 *  without parts). An invoice sent minutes ago and due in 30 days is not
 *  chased — the explicit Remind stays on the customer page and invoices. */
export function balanceWantsReminder(c: ClientCtaInput): boolean {
  if (c.balanceCents <= 0) return false;
  const parts = c.balanceSubParts;
  if (parts?.kind === "dueIn") {
    return (parts.days ?? 0) <= REMINDER_DUE_WITHIN_DAYS;
  }
  return true;
}

/** The client card's CTA (clientsDisplay.cta.*): every label but "Open card"
 *  is a message to the client. */
export function clientCtaAction(c: ClientCtaInput): "message" | "open" {
  if (balanceWantsReminder(c)) return "message"; // "Send a kind reminder"
  if (c.status === "active") return "message"; // "Send progress update"
  if (c.status === "lead") return "message"; // "Follow up"
  if (c.status === "cold") return "message"; // "Send a hello"
  return "open"; // "Open card"
}

/** Which message a client CTA pre-fills (clientsBoard.msg.<kind>). */
export function clientCtaMessageKind(
  c: ClientCtaInput,
): "reminder" | "progress" | "followUp" | "hello" | null {
  if (balanceWantsReminder(c)) return "reminder";
  if (c.status === "active") return "progress";
  if (c.status === "lead") return "followUp";
  if (c.status === "cold") return "hello";
  return null;
}

export type QuoteCtaAction = "resume" | "resend" | "open";

/** The quote card's front CTA: a label that says what the click does. A
 *  draft resumes in the assistant; a quote the customer has (or ignored) is
 *  sent again; anything else opens the quote's panel. */
export function quoteCta(
  stage: string,
  _opens: number,
): { key: string; action: QuoteCtaAction } {
  if (stage === "draft") {
    return { key: "quoteCard.cta.finishSend", action: "resume" };
  }
  if (stage === "opened" || stage === "cooling") {
    return { key: "quoteCard.cta.friendlyNudge", action: "resend" };
  }
  if (stage === "stale") {
    return { key: "quoteCard.cta.winItBack", action: "resend" };
  }
  return { key: "quoteCard.cta.openQuote", action: "open" };
}

/** The newest assistant conversation that holds this quote. */
export function draftConversationFor(
  quoteId: string,
  convos: Array<
    { id: string; quoteId?: string; updatedAt?: string; createdAt?: string }
  >,
): string | undefined {
  return convos
    .filter((c) => c.quoteId === quoteId)
    .sort((a, b) =>
      (b.updatedAt ?? b.createdAt ?? "").localeCompare(
        a.updatedAt ?? a.createdAt ?? "",
      )
    )[0]?.id;
}
