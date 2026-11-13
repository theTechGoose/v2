/**
 * REQ-676 — demo-loop cycle 5, issue c1-M9 (backlog, still present):
 * "Close preview resets the warranty question".
 *
 * The review card's X (aria-label "Close preview") called goBackWizard():
 * the server dropped the last term answer (the warranty) and re-asked it.
 * Now the X is a pure close — the answered terms stay, the send CTA stays
 * in the thread as a "Ready to send" banner with a Review button that
 * reopens the review, and a snapshot whose review was closed by the user is
 * a visible state (not the "dead end" that rewinds one question).
 *
 * Target: shared/quote-flow/assistant-back.ts (sendCtaView,
 * isDeadEndSnapshot), consumed by islands/AsstChat.tsx.
 */
import {
  isDeadEndSnapshot,
  sendCtaView,
  WIZARD_DONE,
} from "../../shared/quote-flow/assistant-back";

describe("REQ-676 c1-M9: the review's X keeps the terms and can be reopened", () => {
  it("an open review renders as the review card", () => {
    expect(
      sendCtaView({ reviewed: false, previewing: true, closedByUser: false }),
    )
      .toBe("preview");
  });

  it("a review the contractor closed renders a Ready-to-send banner to reopen it", () => {
    expect(
      sendCtaView({ reviewed: false, previewing: false, closedByUser: true }),
    )
      .toBe("reopen");
  });

  it("an unreviewed send CTA that was never closed stays hidden (it auto-opens)", () => {
    expect(
      sendCtaView({ reviewed: false, previewing: false, closedByUser: false }),
    )
      .toBe("hidden");
  });

  it("a sent quote keeps its Sent card, closed or not", () => {
    expect(
      sendCtaView({ reviewed: true, previewing: false, closedByUser: true }),
    )
      .toBe("done");
    expect(
      sendCtaView({ reviewed: true, previewing: false, closedByUser: false }),
    )
      .toBe("done");
  });

  it("a snapshot with the review closed by the user is a visible state, not a dead end", () => {
    expect(isDeadEndSnapshot({
      wizardStepIdx: WIZARD_DONE,
      noPanel: true,
      reviewClosedCtaId: "cta-1",
    })).toBe(false);
  });

  it("wizard complete with no panel and no closed review is still the dead end (rewind one question)", () => {
    expect(isDeadEndSnapshot({
      wizardStepIdx: WIZARD_DONE,
      noPanel: true,
      reviewClosedCtaId: null,
    })).toBe(true);
    expect(isDeadEndSnapshot({ wizardStepIdx: WIZARD_DONE, noPanel: false }))
      .toBe(false);
    expect(isDeadEndSnapshot({ wizardStepIdx: 3, noPanel: true }))
      .toBe(false);
  });
});
