/**
 * RED (TDD) — the assistant has ONE back button (the chat-header control,
 * a.chat__head-btn) and it UNDOES the previous action; it never acts as a
 * second browser-back. Reported live: on the quote + agreement preview the
 * header back exited to /dashboard instead of undoing (closing the preview).
 *
 * This unit pins the resolver that decides what the single button does:
 * given the assistant's view state, `resolveAssistantBack` returns the ONE
 * undo action, most-immediate surface first. The exit to /dashboard is the
 * LAST resort (nothing left to undo), never the answer while any in-chat
 * surface (preview, invoice review, job options, price capture, wizard,
 * snapshot stack) is still active.
 *
 * Target: shared/quote-flow/assistant-back.ts
 */
import {
  activeWizardStepIdx,
  backViewFromMessages,
  emptyBackView,
  firstOpenReviewCta,
  resolveAssistantBack,
} from "../../shared/quote-flow/assistant-back";

const base = emptyBackView;

describe("resolveAssistantBack — priority chain", () => {
  it("quote/agreement preview open → close the preview (the reported bug: must NOT exit to dashboard)", () => {
    expect(resolveAssistantBack({ ...base(), previewOpen: true }))
      .toBe("close-preview");
  });

  it("preview wins even when a wizard step or view stack also exists", () => {
    expect(resolveAssistantBack({
      ...base(),
      previewOpen: true,
      activeWizardStepIdx: 3,
      viewStackDepth: 2,
    })).toBe("close-preview");
  });

  it("invoice result (terminal) → exit to dashboard (nothing to undo after the save)", () => {
    expect(resolveAssistantBack({ ...base(), invoiceResultOpen: true }))
      .toBe("exit-dashboard");
  });

  it("invoice review open → back to the invoice customer step", () => {
    expect(resolveAssistantBack({ ...base(), invoiceReviewOpen: true }))
      .toBe("invoice-review-to-customer");
  });

  it("invoice customer step open → back to the price capture", () => {
    expect(resolveAssistantBack({ ...base(), invoiceCustomerOpen: true }))
      .toBe("invoice-customer-to-price");
  });

  it("job-options picker in confirm mode → back to the editable details entry", () => {
    expect(resolveAssistantBack({
      ...base(),
      jobOptionsOpen: true,
      jobOptionsMode: "confirm",
    })).toBe("job-options-to-details");
  });

  it("job-options picker in polish mode → just close the picker", () => {
    expect(resolveAssistantBack({
      ...base(),
      jobOptionsOpen: true,
      jobOptionsMode: "polish",
    })).toBe("close-job-options");
  });

  it("price capture after the help-me-price confirm step → reopen the confirm picker", () => {
    expect(resolveAssistantBack({
      ...base(),
      priceCaptureOpen: true,
      priceAfterConfirm: true,
    })).toBe("price-to-confirm");
  });

  it("plain price capture → one view-step back (details restored for editing)", () => {
    expect(resolveAssistantBack({ ...base(), priceCaptureOpen: true }))
      .toBe("price-step-back");
  });

  it("active wizard step past the first → rewind one step", () => {
    expect(resolveAssistantBack({ ...base(), activeWizardStepIdx: 2 }))
      .toBe("rewind-wizard");
  });

  it("wizard at its first step falls through to the view stack", () => {
    expect(resolveAssistantBack({
      ...base(),
      activeWizardStepIdx: 0,
      viewStackDepth: 1,
    })).toBe("pop-view");
  });

  it("only snapshots left → pop one view", () => {
    expect(resolveAssistantBack({ ...base(), viewStackDepth: 2 }))
      .toBe("pop-view");
  });

  it("nothing left to undo → exit to the dashboard (the ONLY state that exits)", () => {
    expect(resolveAssistantBack(base())).toBe("exit-dashboard");
  });
});

describe("firstOpenReviewCta — the auto-opened preview the button must close", () => {
  const msgs = [
    { id: "m1", kind: "text", payload: {} },
    { id: "m2", kind: "wizard", payload: { stepIdx: 4 } },
    { id: "m3", kind: "continue_cta", payload: { toPhase: "send" } },
  ];

  it("finds the ready-to-send CTA (the preview surface) in a real message list", () => {
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

describe("activeWizardStepIdx — rewindability comes from the LAST message", () => {
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

describe("backViewFromMessages — real conversation ⇒ the button undoes, never exits", () => {
  it("at the reviewing stage (open send-CTA) the resolved action is close-preview", () => {
    const view = backViewFromMessages([
      { id: "m1", kind: "text", payload: {} },
      { id: "m2", kind: "continue_cta", payload: { toPhase: "send" } },
    ]);
    expect(view.previewOpen).toBe(true);
    expect(resolveAssistantBack(view)).toBe("close-preview");
  });
});
