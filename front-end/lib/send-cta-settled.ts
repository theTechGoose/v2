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

/**
 * REQ-339 (demo-loop cycle 1, issue p2 "Chat timestamps a minute early"):
 * the time to stamp on a send CTA. The "Quote + Agreement sent — emailed
 * to …" card is the CTA re-rendered in its sent state, so once it is sent
 * its time is the dispatch — the createdAt of the matching phase-3/4
 * `phase_divider` the server appends after it (the latest one, so a
 * retry after a failed attempt shows the retry) — not the moment the
 * terms wizard finished, 1–2 minutes earlier. Unsent (or settled only by
 * `quote.status`, with no divider in the thread) it keeps its own time.
 */
export function sentCtaTimestamp(
  messages: readonly (ThreadMessage & { createdAt: number })[],
  cta: ThreadMessage & { createdAt: number },
  _quote?: BoundQuote | null,
): number {
  const p = (cta.payload ?? {}) as { toPhase?: string; quoteId?: string };
  const start = messages.indexOf(cta);
  if (start < 0 || p.toPhase !== "send") return cta.createdAt;
  const sameQuote = (other?: string) =>
    !p.quoteId || !other || other === p.quoteId;
  let dispatchedAt: number | undefined;
  for (let j = start + 1; j < messages.length; j++) {
    const d = messages[j];
    if (d.kind !== "phase_divider") continue;
    const dp = (d.payload ?? {}) as { phase?: number; quoteId?: string };
    if ((dp.phase ?? 0) >= DISPATCHED_PHASE && sameQuote(dp.quoteId)) {
      dispatchedAt = d.createdAt;
    }
  }
  return dispatchedAt ?? cta.createdAt;
}

/**
 * REQ-452 (demo-loop cycle 3, issue p8-pair7-b — "'Couldn't send' card
 * renders above a later message"): the send outcome is not a message of its
 * own — it is the send/invoice continue_cta re-rendered "Sent ✓" or
 * "Couldn't send". Drawn where the CTA was created (when the wizard
 * finished), it sat ABOVE anything typed on the review step afterwards,
 * while REQ-339 already stamps it with the dispatch time. So a reviewed CTA
 * whose outcome divider is in the thread is drawn right before the LATEST
 * such divider (the same divider its sent/failed state is read from), i.e.
 * by the send's own time. Unreviewed CTAs, CTAs with no outcome divider yet,
 * and other kinds keep their place. Returns the input array unchanged when
 * nothing moves.
 */
export function orderSendOutcomes<T extends ThreadMessage>(
  messages: readonly T[],
  isReviewed: (m: T) => boolean,
): readonly T[] {
  // CTA id → id of the divider it is drawn before.
  const moveBefore = new Map<string, string>();
  messages.forEach((m, i) => {
    if (m.kind !== "continue_cta") return;
    const p = (m.payload ?? {}) as { toPhase?: string; quoteId?: string };
    if (p.toPhase !== "send" && p.toPhase !== "invoice") return;
    if (!isReviewed(m)) return;
    let outcome: T | undefined;
    for (let j = i + 1; j < messages.length; j++) {
      const d = messages[j];
      if (d.kind !== "phase_divider") continue;
      const dp = (d.payload ?? {}) as {
        quoteId?: string;
        emailedTo?: string;
        textedTo?: string;
        emailFailureReason?: string;
        smsFailureReason?: string;
      };
      if (p.quoteId && dp.quoteId && dp.quoteId !== p.quoteId) continue;
      if (
        dp.emailedTo || dp.textedTo || dp.emailFailureReason ||
        dp.smsFailureReason
      ) outcome = d;
    }
    // Already right before its outcome → nothing to move.
    if (outcome && messages[i + 1] !== outcome) {
      moveBefore.set(m.id, outcome.id);
    }
  });
  if (moveBefore.size === 0) return messages;
  const moving = new Set(moveBefore.keys());
  const byDivider = new Map<string, T[]>();
  for (const m of messages) {
    const d = moveBefore.get(m.id);
    if (d) byDivider.set(d, [...(byDivider.get(d) ?? []), m]);
  }
  const out: T[] = [];
  for (const m of messages) {
    if (moving.has(m.id)) continue;
    const before = byDivider.get(m.id);
    if (before) out.push(...before);
    out.push(m);
  }
  return out;
}
