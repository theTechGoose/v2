/**
 * The assistant's SINGLE back button (a.chat__head-btn) — resolver.
 *
 * Model (2026-08-28): the assistant keeps a stack of snapshots. Every
 * forward move pushes the state it is leaving (client view flags + the
 * server's wizard step cursor); back POPS the latest snapshot and restores
 * it — rewinding the server to the snapshot's step when the wizard moved
 * on. No per-surface rules: whatever you did last is what back undoes.
 *
 * `resolveAssistantBack` is the tiny remaining decision:
 *   1. a saved invoice is terminal — nothing above it can be undone;
 *   2. a snapshot on the stack → pop it;
 *   3. no snapshot (the stack lives in the tab and is empty after a deep
 *      link / hard reload) but the server is mid-flow (a wizard step past
 *      the first, or the review preview) → ask the server for one step
 *      back, derived from the transcript;
 *   4. nothing left → exit to /dashboard.
 */

export interface AssistantBackView {
  /** Quote + agreement preview open (the wizard's send step). */
  previewOpen: boolean;
  /** Terminal invoice-saved card open — nothing above it is undoable. */
  invoiceResultOpen: boolean;
  /** stepIdx of the ACTIVE wizard step (last message), else null. */
  activeWizardStepIdx: number | null;
  /** Depth of the snapshot stack. */
  viewStackDepth: number;
}

export type AssistantBackAction =
  | "pop-view"
  | "rewind-wizard"
  | "exit-dashboard";

export function emptyBackView(): AssistantBackView {
  return {
    previewOpen: false,
    invoiceResultOpen: false,
    activeWizardStepIdx: null,
    viewStackDepth: 0,
  };
}

export function resolveAssistantBack(
  v: AssistantBackView,
): AssistantBackAction {
  if (v.invoiceResultOpen) return "exit-dashboard";
  if (v.viewStackDepth > 0) return "pop-view";
  if (v.previewOpen || (v.activeWizardStepIdx ?? 0) > 0) {
    return "rewind-wizard";
  }
  return "exit-dashboard";
}

// ── message-derived state ──────────────────────────────────────────────
// The rules below read the REAL conversation payload shapes the backend
// emits, so both the island and the integration tests share one source of
// truth for "what is on screen".

export interface AssistantMessageLike {
  id: string;
  kind?: string;
  payload?: unknown;
}

/**
 * The quote + agreement preview surface: the first un-reviewed
 * `continue_cta` message with `toPhase: "send"` auto-opens as the preview.
 */
export function firstOpenReviewCta(
  messages: readonly AssistantMessageLike[],
  reviewedIds?: ReadonlySet<string>,
): string | null {
  for (const m of messages) {
    if (m.kind !== "continue_cta") continue;
    const p = (m.payload ?? {}) as { toPhase?: string };
    if (p.toPhase !== "send") continue;
    if (reviewedIds?.has(m.id)) continue;
    return m.id;
  }
  return null;
}

/** stepIdx when the LAST message is an active wizard step, else null. */
export function activeWizardStepIdx(
  messages: readonly AssistantMessageLike[],
): number | null {
  const last = messages[messages.length - 1];
  if (last?.kind !== "wizard") return null;
  const idx = (last.payload as { stepIdx?: number } | undefined)?.stepIdx;
  return typeof idx === "number" ? idx : null;
}

/** Sentinel step cursor for "the wizard is complete" (review/send stage). */
export const WIZARD_DONE = Number.MAX_SAFE_INTEGER;

/**
 * The server's wizard cursor as seen from the transcript: the active step's
 * index, WIZARD_DONE once the ready-to-send CTA exists, null before the
 * wizard. Snapshots record this so popping one knows whether the server
 * must be rewound too.
 */
export function wizardCursor(
  messages: readonly AssistantMessageLike[],
): number | null {
  if (firstOpenReviewCta(messages) !== null) return WIZARD_DONE;
  // A reviewed (closed) CTA still means the wizard is complete.
  if (
    messages.some((m) =>
      m.kind === "continue_cta" &&
      (m.payload as { toPhase?: string } | undefined)?.toPhase === "send"
    )
  ) {
    return WIZARD_DONE;
  }
  return activeWizardStepIdx(messages);
}

/** Build the resolver's view from a real message list + client-only flags. */
export function backViewFromMessages(
  messages: readonly AssistantMessageLike[],
  ui: Partial<AssistantBackView> & { reviewedCtaIds?: ReadonlySet<string> } =
    {},
): AssistantBackView {
  const { reviewedCtaIds, ...flags } = ui;
  return {
    ...emptyBackView(),
    previewOpen: firstOpenReviewCta(messages, reviewedCtaIds) !== null,
    activeWizardStepIdx: activeWizardStepIdx(messages),
    ...flags,
  };
}
