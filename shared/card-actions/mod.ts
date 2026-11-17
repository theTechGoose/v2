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

/** The client card's CTA (clientsDisplay.cta.*): every label but "Open card"
 *  is a message to the client. */
export function clientCtaAction(
  c: { balanceCents: number; status: string },
): "message" | "open" {
  if (c.balanceCents > 0) return "message"; // "Send a kind reminder"
  if (c.status === "active") return "message"; // "Send progress update"
  if (c.status === "lead") return "message"; // "Follow up"
  if (c.status === "cold") return "message"; // "Send a hello"
  return "open"; // "Open card"
}

/** Which message a client CTA pre-fills (clientsBoard.msg.<kind>). */
export function clientCtaMessageKind(
  c: { balanceCents: number; status: string },
): "reminder" | "progress" | "followUp" | "hello" | null {
  if (c.balanceCents > 0) return "reminder";
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
