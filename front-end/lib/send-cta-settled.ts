/**
 * REQ-244 (demo issue quote-invoice-money-m5) — which "Ready to send"
 * continue_cta messages are already settled, derived from the persisted
 * thread so the answer survives a full page load.
 *
 * AsstChat auto-opens the editable quote review for every send CTA it has
 * not seen reviewed, and the open review hides the message box. The
 * in-memory `reviewedCtas` set starts empty on every load, so before this
 * the review re-opened over an already-sent or signed quote and the
 * composer vanished. The server already records the outcome in the
 * thread: SendQuote appends a phase-3 `phase_divider` and AcceptQuote a
 * phase-4 one, each carrying the quoteId. A send CTA with such a divider
 * AFTER it has been acted on.
 *
 * `quote.status === "sent"` is deliberately NOT a signal: LockQuote stamps
 * status/sentAt when the price is locked, before the terms wizard and the
 * send step, so it would suppress the first review.
 */

interface ThreadMessage {
  id: string;
  kind?: string;
  payload?: unknown;
}

interface BoundQuote {
  id?: string;
  status?: string | null;
  acceptedAt?: string | null;
}

/** Dividers at or past this phase mean the quote left the review step:
 *  3 = sent (SendQuote), 4 = accepted (AcceptQuote). */
const DISPATCHED_PHASE = 3;

export function settledSendCtaIds(
  messages: readonly ThreadMessage[],
  quote?: BoundQuote | null,
): Set<string> {
  const settled = new Set<string>();
  const accepted = !!quote &&
    (quote.status === "accepted" || Boolean(quote.acceptedAt));
  messages.forEach((m, i) => {
    if (m.kind !== "continue_cta") return;
    const p = (m.payload ?? {}) as { toPhase?: string; quoteId?: string };
    if (p.toPhase !== "send") return;
    const sameQuote = (other?: string) =>
      !p.quoteId || !other || other === p.quoteId;
    if (accepted && sameQuote(quote?.id)) {
      settled.add(m.id);
      return;
    }
    for (let j = i + 1; j < messages.length; j++) {
      const d = messages[j];
      if (d.kind !== "phase_divider") continue;
      const dp = (d.payload ?? {}) as { phase?: number; quoteId?: string };
      if ((dp.phase ?? 0) >= DISPATCHED_PHASE && sameQuote(dp.quoteId)) {
        settled.add(m.id);
        return;
      }
    }
  });
  return settled;
}
