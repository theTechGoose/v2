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
  /** stepIdx of the ACTIVE wizard step (activeWizardStepIdx), else null. */
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

/** stepIdx of the active wizard step: the LAST wizard card, when nothing but
 *  a chat turn typed on it came after it — REQ-392: the compact "Tell the
 *  assistant…" box sits on every wizard question, and its question + the
 *  reply land under the card without answering it. A pick (a text carrying
 *  `wizardStepId`), a CTA or any card after it ends the step: null. */
export function activeWizardStepIdx(
  messages: readonly AssistantMessageLike[],
): number | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.kind === "wizard") {
      const idx = (m.payload as { stepIdx?: number } | undefined)?.stepIdx;
      return typeof idx === "number" ? idx : null;
    }
    if (!isChatAside(m)) return null;
  }
  return null;
}

/** A chat message (text / voice / photo) that is not a wizard pick. */
function isChatAside(m: AssistantMessageLike): boolean {
  if (m.kind !== "text" && m.kind !== "voice" && m.kind !== "image") {
    return false;
  }
  return !(m.payload as { wizardStepId?: unknown } | undefined)?.wizardStepId;
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

// ── REQ-676 (demo-loop cycle 5, c1-M9): the review's X is a pure close ──
// It used to rewind the wizard (dropping the last term answer). Now it
// only hides the review; the send CTA then renders as a "Ready to send"
// banner whose Review button reopens it.

/** What a `toPhase: "send"` continue_cta renders as in the thread. */
export type SendCtaView = "preview" | "reopen" | "hidden" | "done";

export function sendCtaView(s: {
  /** Sent / settled (REQ-244). */
  reviewed: boolean;
  /** The review card is open on this CTA. */
  previewing: boolean;
  /** The contractor closed this CTA's review with its X. */
  closedByUser: boolean;
}): SendCtaView {
  if (s.previewing) return "preview";
  if (s.reviewed) return "done";
  // Never closed → it auto-opens; the banner would be redundant.
  return s.closedByUser ? "reopen" : "hidden";
}

/**
 * A history snapshot that renders nothing: the wizard is complete, no
 * panel is open and the review was not closed by the user (a closed
 * review shows its reopen banner, so it IS a visible state). Restoring a
 * dead end rewinds one question instead.
 */
export function isDeadEndSnapshot(s: {
  wizardStepIdx: number | null;
  noPanel: boolean;
  reviewClosedCtaId?: string | null;
}): boolean {
  return s.wizardStepIdx === WIZARD_DONE && s.noPanel && !s.reviewClosedCtaId;
}
