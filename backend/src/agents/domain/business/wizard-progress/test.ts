import { assertEquals, assertThrows } from "#std/assert";
import { applyAnswer, computeProgress, freshState } from "./mod.ts";
import { CONTRACT_TERMS_WIZARD_V1 } from "@agents/domain/business/contract-terms-wizard-spec/mod.ts";

const spec = CONTRACT_TERMS_WIZARD_V1;

Deno.test("freshState: idx 0, no answers, specId pinned", () => {
  const state = freshState(spec);
  assertEquals(state.activeStepIdx, 0);
  assertEquals(state.answers, []);
  assertEquals(state.specId, spec.id);
});

Deno.test("computeProgress: fresh state — first step is active, all 9 remain", () => {
  const p = computeProgress(spec, freshState(spec));
  assertEquals(p.activeStep?.id, "config");
  assertEquals(p.completedSteps.length, 0);
  assertEquals(p.remainingSteps.length, 9);
  assertEquals(p.isComplete, false);
  assertEquals(p.fractionDone, 0);
});

Deno.test("applyAnswer: advances to the next step and records the answer", () => {
  const next = applyAnswer(spec, freshState(spec), {
    stepId: "config",
    optionId: "standard_residential",
  });
  assertEquals(next.activeStepIdx, 1);
  assertEquals(next.answers.length, 1);
  assertEquals(next.answers[0].stepId, "config");
  assertEquals(next.answers[0].optionId, "standard_residential");
});

Deno.test("computeProgress: midway through — 4 completed, 1 active, 5 remaining", () => {
  let state = freshState(spec);
  for (let i = 0; i < 4; i++) {
    const step = spec.steps[i];
    const opt = step.options.find((o) => !o.isCustom)!;
    state = applyAnswer(spec, state, { stepId: step.id, optionId: opt.id });
  }
  const p = computeProgress(spec, state);
  assertEquals(p.activeStep?.id, "payment_terms");      // step 5 (index 4)
  assertEquals(p.completedSteps.length, 4);
  assertEquals(p.remainingSteps.length, 5);
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
  assertEquals(p.completedSteps.length, 10);
  assertEquals(p.remainingSteps.length, 0);
  assertEquals(p.isComplete, true);
  assertEquals(p.fractionDone, 1);
});

Deno.test("applyAnswer: out-of-order stepId throws", () => {
  assertThrows(
    () => applyAnswer(spec, freshState(spec), { stepId: "warranty", optionId: "12_months" }),
    Error,
    'expected answer for "config"',
  );
});

Deno.test("applyAnswer: unknown optionId throws", () => {
  assertThrows(
    () => applyAnswer(spec, freshState(spec), { stepId: "config", optionId: "nope" }),
    Error,
    'unknown option "nope"',
  );
});

Deno.test("applyAnswer: isCustom option without customValue throws", () => {
  // step "customer" has create_new isCustom
  let state = applyAnswer(spec, freshState(spec), { stepId: "config", optionId: "standard_residential" });
  assertThrows(
    () => applyAnswer(spec, state, { stepId: "customer", optionId: "create_new" }),
    Error,
    'requires a customValue',
  );
});

Deno.test("applyAnswer: isCustom option WITH customValue records customValue", () => {
  let state = applyAnswer(spec, freshState(spec), { stepId: "config", optionId: "standard_residential" });
  state = applyAnswer(spec, state, {
    stepId: "customer",
    optionId: "create_new",
    customValue: "Tom & Linda K.",
  });
  assertEquals(state.answers[1].customValue, "Tom & Linda K.");
});

Deno.test("applyAnswer: non-custom option ignores customValue (doesn't get recorded)", () => {
  let state = applyAnswer(spec, freshState(spec), {
    stepId: "config",
    optionId: "standard_residential",
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
    () => applyAnswer(spec, state, { stepId: "config", optionId: "standard_residential" }),
    Error,
    "wizard already complete",
  );
});
