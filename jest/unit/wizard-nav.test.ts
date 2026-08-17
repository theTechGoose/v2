/**
 * PDF p2 + p3 + p8 — back navigation through the quote-flow steps:
 *   - "Fix the Go Back button for all of the tasks because the Job Details
 *      is not editable so they need a back button." (p2)
 *   - "There is no back button for the steps — needs a back button throughout
 *      the steps so they can easily be edited." (p8)
 *   - "When you have the invoice the go back button takes you to the
 *      Dashboard." (p3 — the terminal stage exits to the dashboard)
 *
 * Target: shared/quote-flow/wizard-nav.ts
 */
import { backTarget, canGoBack, goBack } from "../../shared/quote-flow/wizard-nav";

const STEPS = ["job-details", "customer", "terms", "price", "review", "invoice"] as const;

function state(stepIndex: number, answers: Record<string, unknown> = {}) {
  return { steps: [...STEPS], stepIndex, answers };
}

describe("canGoBack", () => {
  it("every step after the first can go back", () => {
    for (let i = 1; i < STEPS.length; i++) {
      expect(canGoBack(state(i))).toBe(true);
    }
  });

  it("the first step cannot step back further", () => {
    expect(canGoBack(state(0))).toBe(false);
  });
});

describe("goBack", () => {
  it("moves exactly one step backwards", () => {
    expect(goBack(state(3)).stepIndex).toBe(2);
  });

  it("preserves every previously entered answer so steps are EDITABLE, not lost", () => {
    const s = state(3, {
      "job-details": "Remove old toilet\nInstall new toilet",
      customer: { name: "Iron Man" },
      terms: { warranty: "6 months" },
    });
    const back = goBack(s);
    expect(back.answers).toEqual(s.answers);
  });

  it("lands on the job-details step with its content intact (p2: details must be editable)", () => {
    const s = state(1, { "job-details": "Remove old toilet" });
    const back = goBack(s);
    expect(back.stepIndex).toBe(0);
    expect(back.answers["job-details"]).toBe("Remove old toilet");
  });
});

describe("backTarget", () => {
  it("mid-flow, back targets the previous step", () => {
    expect(backTarget(state(2))).toBe("previous-step");
  });

  it("at the terminal invoice stage, back exits to the dashboard (p3)", () => {
    expect(backTarget(state(STEPS.length - 1))).toBe("dashboard");
  });

  it("at the first step with nothing to rewind, back exits to the dashboard", () => {
    expect(backTarget(state(0))).toBe("dashboard");
  });
});
