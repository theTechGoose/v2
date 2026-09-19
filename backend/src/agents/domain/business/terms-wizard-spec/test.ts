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

// REQ-009 — NW-23 (p22): "'When does the job start?' has a 'Job Completed'
// option. Remove it and put 'Pick a date' in its place."
Deno.test("REQ-009 NW-23 terms-wizard-spec: start_date offers asap / next_week / next_month / custom — no job_completed", () => {
  const start = TERMS_WIZARD_V1.steps.find((s) => s.id === "start_date")!;
  assertEquals(start.options.map((o) => o.id), ["asap", "next_week", "next_month", "custom"]);
  assertEquals(start.options.at(-1)?.isCustom, true, "'Pick a date' is the last option");
});

Deno.test("REQ-009 NW-23 terms-wizard-spec: the duration (wraps) step keeps its own job_completed", () => {
  const wraps = TERMS_WIZARD_V1.steps.find((s) => s.id === "wraps")!;
  assert(wraps.options.some((o) => o.id === "job_completed"));
});

// REQ-024 — NW-13 / NW-18 (p9, p27): "if there is no quote to select, go
// through the same questions as the quote (skip how long it took, but ask
// for the completion date)." A second spec for the invoice path.
import { INVOICE_WIZARD_V1 } from "./mod.ts";

Deno.test("REQ-024 NW-13/18 INVOICE_WIZARD_V1: customer → completion_date → payment_terms → warranty (no start_date, no wraps)", () => {
  assertEquals(INVOICE_WIZARD_V1.id, "invoice-v1");
  assertEquals(INVOICE_WIZARD_V1.steps.map((s) => s.id), [
    "customer",
    "completion_date",
    "payment_terms",
    "warranty",
  ]);
  const completion = INVOICE_WIZARD_V1.steps.find((s) => s.id === "completion_date")!;
  assertEquals(completion.options.map((o) => o.id), ["today", "yesterday", "last_week", "custom"]);
  assertEquals(completion.options.at(-1)?.isCustom, true);
  // The shared steps are the SAME objects as the quote wizard's.
  const q = (id: string) => TERMS_WIZARD_V1.steps.find((s) => s.id === id)!;
  const i = (id: string) => INVOICE_WIZARD_V1.steps.find((s) => s.id === id)!;
  assertEquals(i("customer").options, q("customer").options);
  assertEquals(i("payment_terms").options, q("payment_terms").options);
  assertEquals(i("warranty").options, q("warranty").options);
});

Deno.test("REQ-024 getWizardSpec resolves both wizards by id", () => {
  assertEquals(getWizardSpec("invoice-v1"), INVOICE_WIZARD_V1);
  assertEquals(getWizardSpec("terms-v1"), TERMS_WIZARD_V1);
});
