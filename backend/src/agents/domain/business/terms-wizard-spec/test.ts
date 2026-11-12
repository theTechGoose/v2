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
  // REQ-046 (2026-09-30): "add TBD to when does the job start" — a fifth
  // option, between "Next month" and "Pick a date"; "Pick a date" stays last.
  assertEquals(start.options.map((o) => o.id), ["asap", "next_week", "next_month", "tbd", "custom"]);
  assertEquals(start.options.at(-1)?.isCustom, true, "'Pick a date' is the last option");
});

// REVISION by REQ-343 (demo-loop cycle 1, p6): the duration step no longer
// offers "Job completed" either — a quote's job has not started. The
// sentence-case label (NW-24) still localizes on old quotes.
Deno.test("REQ-009 NW-23 / REQ-343 terms-wizard-spec: no wraps job_completed; the label key stays for old quotes", () => {
  const wraps = TERMS_WIZARD_V1.steps.find((s) => s.id === "wraps")!;
  assertEquals(wraps.options.some((o) => o.id === "job_completed"), false);
  assertEquals(t("en", "termsWizard.wraps.jobCompleted"), "Job completed");
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

// REQ-046 / REQ-047 (2026-09-30), Raphael: "in the wizard we need to add TBD
// to when does the job start and how long will the job take."
import { localizeOptions } from "./mod.ts";

Deno.test("REQ-046 terms-wizard-spec: start_date offers a plain (non-custom) 'tbd' option, labelled TBD / Por definir", () => {
  const start = TERMS_WIZARD_V1.steps.find((s) => s.id === "start_date")!;
  const tbd = start.options.find((o) => o.id === "tbd");
  assert(tbd, "start_date has a 'tbd' option");
  assert(!tbd.isCustom, "TBD is a one-tap pick, not a custom form");
  assertEquals(localizeOptions([tbd], "en")[0].label, "TBD");
  assertEquals(localizeOptions([tbd], "es")[0].label, "Por definir");
});

Deno.test("REQ-047 terms-wizard-spec: wraps offers a plain 'tbd' option just before custom, labelled TBD / Por definir", () => {
  const wraps = TERMS_WIZARD_V1.steps.find((s) => s.id === "wraps")!;
  // REQ-343: "job_completed" left the quote wizard's duration step.
  assertEquals(wraps.options.map((o) => o.id), [
    "1_day",
    "2_3_days",
    "1_week",
    "2_weeks",
    "tbd",
    "custom",
  ]);
  const tbd = wraps.options.find((o) => o.id === "tbd")!;
  assert(!tbd.isCustom, "TBD is a one-tap pick, not a custom form");
  assertEquals(localizeOptions([tbd], "en")[0].label, "TBD");
  assertEquals(localizeOptions([tbd], "es")[0].label, "Por definir");
});

// REQ-343 — demo-loop cycle 1, p3 + p6: the wizard fits the trade. A service
// business (cleaning, lawn, junk removal) gets hours presets and no warranty
// question; every quote wizard drops "Job completed" (a duration for a job
// that has not started); the invoice wizard keeps its warranty step.
import { TERMS_WIZARD_SERVICE_V1, wizardSpecFor } from "./mod.ts";

Deno.test("REQ-343 p6 wizardSpecFor('quote'): no 'Job completed' on the quote wizard's duration step", () => {
  const wraps = wizardSpecFor("quote").steps.find((s) => s.id === "wraps")!;
  assertEquals(wraps.options.some((o) => o.id === "job_completed"), false);
  assertEquals(wraps.options.map((o) => o.id), ["1_day", "2_3_days", "1_week", "2_weeks", "tbd", "custom"]);
});

Deno.test("REQ-343 p3/p6 wizardSpecFor('quote', 'service'): hours presets, no warranty step, own spec id", () => {
  const spec = wizardSpecFor("quote", "service");
  assertEquals(spec, TERMS_WIZARD_SERVICE_V1);
  assertEquals(spec.id, "terms-service-v1");
  assertEquals(spec.steps.map((s) => s.id), ["customer", "start_date", "wraps", "payment_terms"]);
  const wraps = spec.steps.find((s) => s.id === "wraps")!;
  assertEquals(wraps.options.map((o) => o.id), [
    "2_hours",
    "4_hours",
    "half_day",
    "1_day",
    "2_3_days",
    "tbd",
    "custom",
  ]);
  assertEquals(wraps.options.at(-1)?.isCustom, true);
  // Customer, start date and payment terms are the SAME step objects.
  const q = (id: string) => TERMS_WIZARD_V1.steps.find((s) => s.id === id)!;
  for (const id of ["customer", "start_date", "payment_terms"]) {
    assert(spec.steps.find((s) => s.id === id) === q(id), `${id} is shared`);
  }
});

Deno.test("REQ-343 wizardSpecFor: 'project' and undefined trade get the generic quote wizard; invoices ignore the trade and keep warranty", () => {
  assertEquals(wizardSpecFor("quote", "project"), TERMS_WIZARD_V1);
  assertEquals(wizardSpecFor("quote"), TERMS_WIZARD_V1);
  assertEquals(wizardSpecFor(undefined, "service"), TERMS_WIZARD_SERVICE_V1);
  assertEquals(wizardSpecFor("invoice", "service"), INVOICE_WIZARD_V1);
  assert(INVOICE_WIZARD_V1.steps.some((s) => s.id === "warranty"));
});

Deno.test("REQ-343 getWizardSpec: the service spec is registered by id so a mid-wizard answer resolves it", () => {
  assertEquals(getWizardSpec("terms-service-v1"), TERMS_WIZARD_SERVICE_V1);
  const wraps = getWizardSpec("terms-service-v1").steps.find((s) => s.id === "wraps")!;
  assertEquals(t("en", wraps.options[0].label), "2 hours");
  assertEquals(t("es", wraps.options[2].label), "Medio día");
});
import { t } from "@core/i18n/mod.ts";
