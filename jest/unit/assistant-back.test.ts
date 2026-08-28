/**
 * The assistant has ONE back button (the chat-header control,
 * a.chat__head-btn). Model (2026-08-28): every forward move pushes a
 * snapshot (client view flags + the server's wizard cursor); back POPS the
 * latest snapshot and restores it, rewinding the server to the snapshot's
 * step when the wizard moved on. The resolver only decides the edges.
 *
 * Target: shared/quote-flow/assistant-back.ts
 */
import {
  activeWizardStepIdx,
  backViewFromMessages,
  emptyBackView,
  firstOpenReviewCta,
  resolveAssistantBack,
  WIZARD_DONE,
  wizardCursor,
} from "../../shared/quote-flow/assistant-back";

const base = emptyBackView;

describe("resolveAssistantBack — pop the stack; the rest are edges", () => {
  it("a snapshot on the stack → pop it (the one normal case)", () => {
    expect(resolveAssistantBack({ ...base(), viewStackDepth: 2 }))
      .toBe("pop-view");
  });

  it("the stack wins over anything derived from the transcript", () => {
    expect(resolveAssistantBack({
      ...base(),
      viewStackDepth: 1,
      previewOpen: true,
      activeWizardStepIdx: 3,
    })).toBe("pop-view");
  });

  it("empty stack (deep link / reload) but the review preview is open → server rewinds one step", () => {
    expect(resolveAssistantBack({ ...base(), previewOpen: true }))
      .toBe("rewind-wizard");
  });

  it("empty stack but a wizard step past the first is active → server rewinds one step", () => {
    expect(resolveAssistantBack({ ...base(), activeWizardStepIdx: 2 }))
      .toBe("rewind-wizard");
  });

  it("empty stack at the wizard's first step → nothing to rewind → exit", () => {
    expect(resolveAssistantBack({ ...base(), activeWizardStepIdx: 0 }))
      .toBe("exit-dashboard");
  });

  it("saved invoice is terminal → exit, even with snapshots below it", () => {
    expect(resolveAssistantBack({
      ...base(),
      invoiceResultOpen: true,
      viewStackDepth: 3,
    })).toBe("exit-dashboard");
  });

  it("nothing at all → exit to the dashboard", () => {
    expect(resolveAssistantBack(base())).toBe("exit-dashboard");
  });
});

describe("firstOpenReviewCta — the auto-opened preview surface", () => {
  const msgs = [
    { id: "m1", kind: "text", payload: {} },
    { id: "m2", kind: "wizard", payload: { stepIdx: 4 } },
    { id: "m3", kind: "continue_cta", payload: { toPhase: "send" } },
  ];

  it("finds the ready-to-send CTA in a real message list", () => {
    expect(firstOpenReviewCta(msgs)).toBe("m3");
  });

  it("a reviewed (closed) CTA does not reopen", () => {
    expect(firstOpenReviewCta(msgs, new Set(["m3"]))).toBeNull();
  });

  it("other continue_cta phases are not the send preview", () => {
    expect(
      firstOpenReviewCta([{ id: "x", kind: "continue_cta", payload: { toPhase: "terms" } }]),
    ).toBeNull();
  });
});

describe("activeWizardStepIdx — the active step comes from the LAST message", () => {
  it("reads stepIdx when the last message is an active wizard step", () => {
    expect(activeWizardStepIdx([
      { id: "a", kind: "text", payload: {} },
      { id: "b", kind: "wizard", payload: { stepIdx: 2 } },
    ])).toBe(2);
  });

  it("null when the flow has moved past the wizard", () => {
    expect(activeWizardStepIdx([
      { id: "a", kind: "wizard", payload: { stepIdx: 2 } },
      { id: "b", kind: "continue_cta", payload: { toPhase: "send" } },
    ])).toBeNull();
  });
});

describe("wizardCursor — what a snapshot records about the server", () => {
  it("is the active step's index mid-wizard", () => {
    expect(wizardCursor([{ id: "b", kind: "wizard", payload: { stepIdx: 2 } }]))
      .toBe(2);
  });

  it("is WIZARD_DONE once the send CTA exists — open or already reviewed", () => {
    expect(wizardCursor([
      { id: "a", kind: "wizard", payload: { stepIdx: 4 } },
      { id: "b", kind: "continue_cta", payload: { toPhase: "send" } },
    ])).toBe(WIZARD_DONE);
  });

  it("is null before the wizard", () => {
    expect(wizardCursor([{ id: "a", kind: "text", payload: {} }])).toBeNull();
  });

  it("a completed cursor is later than every step, so popping any wizard snapshot rewinds", () => {
    expect(WIZARD_DONE > 4).toBe(true);
  });
});

describe("backViewFromMessages — real conversation with an empty stack", () => {
  it("at the reviewing stage (open send-CTA) the fallback is a server rewind, never an exit", () => {
    const view = backViewFromMessages([
      { id: "m1", kind: "text", payload: {} },
      { id: "m2", kind: "continue_cta", payload: { toPhase: "send" } },
    ]);
    expect(view.previewOpen).toBe(true);
    expect(resolveAssistantBack(view)).toBe("rewind-wizard");
  });
});
