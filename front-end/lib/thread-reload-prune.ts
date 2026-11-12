/**
 * REQ-318 (demo issue m50, cycle 1) — which persisted thread messages the
 * live view has already retired, so a reload renders the same thread the
 * user saw live.
 *
 * Two live actions prune locally but the server keeps the message:
 *   - "Lock it in" (`lockActionCard`) drops the clicked DRAFT action_card
 *     and appends the server's locked card + terms CTA. The draft card
 *     stays in the store, so a reload used to bring it back dimmed with a
 *     "Superseded" chip the live view never showed.
 *   - "Business" / "Person" (`submitContinueCta`, toPhase "terms") drops
 *     the CTA and appends the phase-2 divider + first wizard step. The
 *     CTA stays in the store, and the reload-time collapse only knew
 *     about `wizard` steps, so the answered question came back with live
 *     buttons.
 *
 * One pure rule over the persisted thread decides both, derived from what
 * the server itself appends afterwards (no local memory needed):
 *   - a draft action_card is hidden when a LATER action_card for the same
 *     quote has left draft (LockQuote / the chat lock branch append it);
 *   - a terms continue_cta is hidden when the terms phase was entered after
 *     it — a later `phase_divider` with phase >= 2 (TransitionToTerms) or a
 *     later `wizard` step — or when a later terms CTA replaced it (re-lock).
 */

interface ThreadMessage {
  id: string;
  kind?: string;
  payload?: unknown;
}

const TERMS_PHASE = 2;

export function hiddenOnReloadIds(
  messages: readonly ThreadMessage[],
): Set<string> {
  const hidden = new Set<string>();
  messages.forEach((m, i) => {
    const p = (m.payload ?? {}) as {
      status?: string;
      quoteId?: string;
      toPhase?: string;
    };
    const later = messages.slice(i + 1);

    if (m.kind === "action_card" && p.status === "draft" && p.quoteId) {
      const superseded = later.some((x) => {
        if (x.kind !== "action_card") return false;
        const xp = (x.payload ?? {}) as { status?: string; quoteId?: string };
        return xp.quoteId === p.quoteId && xp.status !== "draft";
      });
      if (superseded) hidden.add(m.id);
      return;
    }

    if (m.kind === "continue_cta" && p.toPhase === "terms") {
      const answered = later.some((x) => {
        if (x.kind === "wizard") return true;
        const xp = (x.payload ?? {}) as {
          phase?: number;
          toPhase?: string;
          quoteId?: string;
        };
        if (x.kind === "phase_divider") return (xp.phase ?? 0) >= TERMS_PHASE;
        if (x.kind === "continue_cta" && xp.toPhase === "terms") {
          return !p.quoteId || !xp.quoteId || xp.quoteId === p.quoteId;
        }
        return false;
      });
      if (answered) hidden.add(m.id);
    }
  });
  return hidden;
}
