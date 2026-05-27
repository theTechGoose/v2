import { assertEquals, assertThrows } from "#std/assert";
import { applyAnswer, computeProgress, freshState } from "./mod.ts";
import { CONTRACT_TERMS_WIZARD_V1 } from "@agents/domain/business/contract-terms-wizard-spec/mod.ts";

const spec = CONTRACT_TERMS_WIZARD_V1;

// The terms wizard is the current 5-step spec (customer, start_date, wraps,
// payment_terms, warranty). The earlier 10-step version's extra steps are now
// baked into the contract templates — see contract-terms-wizard-spec/mod.ts.

Deno.test("freshState: idx 0, no answers, specId pinned", () => {
  const state = freshState(spec);
  assertEquals(state.activeStepIdx, 0);
  assertEquals(state.answers, []);
  assertEquals(state.specId, spec.id);
});

Deno.test("computeProgress: fresh state — first step is active, all 4 remain", () => {
  const p = computeProgress(spec, freshState(spec));
  assertEquals(p.activeStep?.id, "customer");
  assertEquals(p.completedSteps.length, 0);
  assertEquals(p.remainingSteps.length, 4);
  assertEquals(p.isComplete, false);
  assertEquals(p.fractionDone, 0);
});

Deno.test("applyAnswer: advances to the next step and records the answer", () => {
  const next = applyAnswer(spec, freshState(spec), {
    stepId: "customer",
    optionId: "use_active",
  });
  assertEquals(next.activeStepIdx, 1);
  assertEquals(next.answers.length, 1);
  assertEquals(next.answers[0].stepId, "customer");
  assertEquals(next.answers[0].optionId, "use_active");
});

Deno.test("computeProgress: midway through — 2 completed, 1 active, 2 remaining", () => {
  let state = freshState(spec);
  for (let i = 0; i < 2; i++) {
    const step = spec.steps[i];
    const opt = step.options.find((o) => !o.isCustom)!;
    state = applyAnswer(spec, state, { stepId: step.id, optionId: opt.id });
  }
  const p = computeProgress(spec, state);
  assertEquals(p.activeStep?.id, "wraps"); // step 3 (index 2)
  assertEquals(p.completedSteps.length, 2);
  assertEquals(p.remainingSteps.length, 2);
  assertEquals(p.isComplete, false);
  assertEquals(p.fractionDone, 0.4);
});

Deno.test("computeProgress: after final answer — isComplete and fractionDone == 1", () => {
  let state = freshState(spec);
  for (const step of spec.steps) {
    const opt = step.options.find((o) => !o.isCustom)!;
    state = applyAnswer(spec, state, { stepId: step.id, optionId: opt.id });
  }
  const p = computeProgress(spec, state);
  assertEquals(p.activeStep, null);
  assertEquals(p.completedSteps.length, 5);
  assertEquals(p.remainingSteps.length, 0);
  assertEquals(p.isComplete, true);
  assertEquals(p.fractionDone, 1);
});

Deno.test("applyAnswer: out-of-order stepId throws", () => {
  assertThrows(
    () =>
      applyAnswer(spec, freshState(spec), {
        stepId: "warranty",
        optionId: "12_months",
      }),
    Error,
    'expected answer for "customer"',
  );
});

Deno.test("applyAnswer: unknown optionId throws", () => {
  assertThrows(
    () =>
      applyAnswer(spec, freshState(spec), {
        stepId: "customer",
        optionId: "nope",
      }),
    Error,
    'unknown option "nope"',
  );
});

Deno.test("applyAnswer: isCustom option without customValue throws", () => {
  // step "customer" has create_new (isCustom)
  assertThrows(
    () =>
      applyAnswer(spec, freshState(spec), {
        stepId: "customer",
        optionId: "create_new",
      }),
    Error,
    "requires a customValue",
  );
});

Deno.test("applyAnswer: isCustom option WITH customValue records customValue", () => {
  const state = applyAnswer(spec, freshState(spec), {
    stepId: "customer",
    optionId: "create_new",
    customValue: "Tom & Linda K.",
  });
  assertEquals(state.answers[0].customValue, "Tom & Linda K.");
});

Deno.test("applyAnswer: non-custom option ignores customValue (doesn't get recorded)", () => {
  const state = applyAnswer(spec, freshState(spec), {
    stepId: "customer",
    optionId: "use_active",
    customValue: "should be ignored",
  });
  assertEquals(state.answers[0].customValue, undefined);
});

Deno.test("applyAnswer: throws when wizard is already complete", () => {
  let state = freshState(spec);
  for (const step of spec.steps) {
    const opt = step.options.find((o) => !o.isCustom)!;
    state = applyAnswer(spec, state, { stepId: step.id, optionId: opt.id });
  }
  assertThrows(
    () =>
      applyAnswer(spec, state, { stepId: "customer", optionId: "use_active" }),
    Error,
    "wizard already complete",
  );
});
