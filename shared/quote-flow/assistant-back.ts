/**
 * The assistant's SINGLE back button (a.chat__head-btn) — resolver.
 *
 * Product rule (2026-08-19): the chat header carries the ONLY back control
 * in the assistant; no widget or chat-message renders its own. The button
 * UNDOES the previous action — it never acts as a second browser back.
 *
 * `resolveAssistantBack` maps the assistant's current view state to the ONE
 * undo that applies, most-immediate surface first. "exit-dashboard" is the
 * last resort (nothing left to undo) and the invoice-result terminal state
 * (a saved invoice cannot be un-saved).
 */

export interface AssistantBackView {
  /** Quote + agreement preview card open (previewCtaId !== null). */
  previewOpen: boolean;
  /** Terminal invoice-saved card open — nothing above it is undoable. */
  invoiceResultOpen: boolean;
  /** Invoice pre-save review open. */
  invoiceReviewOpen: boolean;
  /** Invoice flow customer step open. */
  invoiceCustomerOpen: boolean;
  /** Job-details option picker open. */
  jobOptionsOpen: boolean;
  /** Picker mode when open: "confirm" (pre-quote) or "polish". */
  jobOptionsMode: "confirm" | "polish" | null;
  /** Price capture screen open. */
  priceCaptureOpen: boolean;
  /** Help-me-price: pricing came after a confirm step it can reopen. */
  priceAfterConfirm: boolean;
  /** stepIdx of the ACTIVE wizard step (last message), else null. */
  activeWizardStepIdx: number | null;
  /** Depth of the in-chat view snapshot stack. */
  viewStackDepth: number;
}

export type AssistantBackAction =
  | "close-preview"
  | "invoice-review-to-customer"
  | "invoice-customer-to-price"
  | "job-options-to-details"
  | "close-job-options"
  | "price-to-confirm"
  | "price-step-back"
  | "rewind-wizard"
  | "pop-view"
  | "exit-dashboard";

export function emptyBackView(): AssistantBackView {
  return {
    previewOpen: false,
    invoiceResultOpen: false,
    invoiceReviewOpen: false,
    invoiceCustomerOpen: false,
    jobOptionsOpen: false,
    jobOptionsMode: null,
    priceCaptureOpen: false,
    priceAfterConfirm: false,
    activeWizardStepIdx: null,
    viewStackDepth: 0,
  };
}

export function resolveAssistantBack(
  v: AssistantBackView,
): AssistantBackAction {
  if (v.previewOpen) return "close-preview";
  if (v.invoiceResultOpen) return "exit-dashboard";
  if (v.invoiceReviewOpen) return "invoice-review-to-customer";
  if (v.invoiceCustomerOpen) return "invoice-customer-to-price";
  if (v.jobOptionsOpen) {
    return v.jobOptionsMode === "confirm"
      ? "job-options-to-details"
      : "close-job-options";
  }
  if (v.priceCaptureOpen) {
    return v.priceAfterConfirm ? "price-to-confirm" : "price-step-back";
  }
  if ((v.activeWizardStepIdx ?? 0) > 0) return "rewind-wizard";
  if (v.viewStackDepth > 0) return "pop-view";
  return "exit-dashboard";
}

// ── message-derived state ──────────────────────────────────────────────
// The two rules below read the REAL conversation payload shapes the
// backend emits, so both the island and the integration tests share one
// source of truth for "what is on screen".

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
