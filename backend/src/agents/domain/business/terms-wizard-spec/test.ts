import { assert, assertEquals, assertThrows } from "#std/assert";
import { getWizardSpec, TERMS_WIZARD_V1 } from "./mod.ts";

Deno.test("terms-wizard-spec: has exactly 5 steps in the documented order", () => {
  assertEquals(TERMS_WIZARD_V1.steps.length, 5);
  const ids = TERMS_WIZARD_V1.steps.map((s) => s.id);
  assertEquals(ids, [
    "customer",
    "start_date",
    "wraps",
    "payment_terms",
    "warranty",
  ]);
});

Deno.test("terms-wizard-spec: every step has id, label, question, and at least 2 options", () => {
  for (const step of TERMS_WIZARD_V1.steps) {
    assert(step.id.length > 0, `step ${step.id} missing id`);
    assert(step.label.length > 0, `step ${step.id} missing label`);
    assert(step.question.length > 0, `step ${step.id} missing question`);
    assert(step.options.length >= 2, `step ${step.id} should have ≥2 options`);
    for (const opt of step.options) {
      assert(opt.id.length > 0, `option ${opt.id} missing id`);
      assert(opt.label.length > 0, `option ${opt.id} missing label`);
    }
  }
});

Deno.test("terms-wizard-spec: option ids are unique within each step", () => {
  for (const step of TERMS_WIZARD_V1.steps) {
    const ids = step.options.map((o) => o.id);
    assertEquals(
      new Set(ids).size,
      ids.length,
      `step ${step.id} has duplicate option ids`,
    );
  }
});

Deno.test("getWizardSpec: returns the canonical spec by id", () => {
  assertEquals(getWizardSpec("terms-v1"), TERMS_WIZARD_V1);
});

Deno.test("getWizardSpec: unknown id throws", () => {
  assertThrows(() => getWizardSpec("nope"));
});
