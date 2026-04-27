import { assert, assertEquals, assertThrows } from "#std/assert";
import { CONTRACT_TERMS_WIZARD_V1, getWizardSpec } from "./mod.ts";

Deno.test("contract-terms-wizard-spec: has exactly 10 steps in the documented order", () => {
  assertEquals(CONTRACT_TERMS_WIZARD_V1.steps.length, 10);
  const ids = CONTRACT_TERMS_WIZARD_V1.steps.map((s) => s.id);
  assertEquals(ids, [
    "config",
    "customer",
    "start_date",
    "wraps",
    "payment_terms",
    "warranty",
    "termination",
    "dispute",
    "governing_state",
    "state_notices",
  ]);
});

Deno.test("contract-terms-wizard-spec: every step has id, label, question, and at least 2 options", () => {
  for (const step of CONTRACT_TERMS_WIZARD_V1.steps) {
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

Deno.test("contract-terms-wizard-spec: option ids are unique within each step", () => {
  for (const step of CONTRACT_TERMS_WIZARD_V1.steps) {
    const ids = step.options.map((o) => o.id);
    assertEquals(new Set(ids).size, ids.length, `step ${step.id} has duplicate option ids`);
  }
});

Deno.test("contract-terms-wizard-spec: dispute step exposes only allowed Contract DTO methods", () => {
  const dispute = CONTRACT_TERMS_WIZARD_V1.steps.find((s) => s.id === "dispute")!;
  const ids = dispute.options.map((o) => o.id);
  assertEquals(ids, ["mediation", "arbitration", "court"]);
});

Deno.test("getWizardSpec: returns the canonical spec by id", () => {
  assertEquals(getWizardSpec("contract-terms-v1"), CONTRACT_TERMS_WIZARD_V1);
});

Deno.test("getWizardSpec: unknown id throws", () => {
  assertThrows(() => getWizardSpec("nope"));
});
