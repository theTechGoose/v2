/**
 * REQ-585 (demo-loop cycle 4, M4 + M30) — the agreement terms typed in the
 * chat. Pair 7 typed "we start monday nov 23. and I want a 50% deposit
 * upfront…" on the start-date card, then "oops no, empezamos la próxima
 * semana, no el próximo mes" and "its 2 and a half weeks not 2" — no chat tool
 * could change a term and nothing said so (fleet-6 stdout:226/251/254).
 *
 * The pure rules: the update_terms values read on the server (a date in the
 * contractor's words, against today; a duration that keeps its half), the
 * wizard option they are, the reply line, and which terms a message names.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { TERMS_WIZARD_V1 } from "@agents/domain/business/terms-wizard-spec/mod.ts";
import {
  askedTerms,
  durationPick,
  mentionedTerms,
  paymentPick,
  pickForStep,
  startPick,
  termsChangeLine,
  termsNotAppliedLine,
  termsPicks,
} from "./mod.ts";

/** Thursday, Nov 12 2026 — the demo's day. */
const TODAY = new Date(2026, 10, 12);
const step = (id: string) => TERMS_WIZARD_V1.steps.find((s) => s.id === id)!;

Deno.test("REQ-585 startPick: the presets, in English and Spanish", () => {
  for (
    const s of [
      "next week",
      "next_week",
      "la próxima semana",
      "la semana que viene",
    ]
  ) {
    assertEquals(startPick(s, TODAY), {
      stepId: "start_date",
      optionId: "next_week",
    }, s);
  }
  for (const s of ["next month", "el próximo mes", "el mes que viene"]) {
    assertEquals(startPick(s, TODAY)?.optionId, "next_month", s);
  }
  for (const s of ["right away", "asap", "ASAP", "de inmediato", "ya mismo"]) {
    assertEquals(startPick(s, TODAY)?.optionId, "asap", s);
  }
  for (const s of ["TBD", "tbd", "por definir", "not sure yet"]) {
    assertEquals(startPick(s, TODAY)?.optionId, "tbd", s);
  }
});

Deno.test("REQ-585 startPick: a date in the contractor's words is resolved against today — 'monday nov 23' is Nov 23, never the next Monday", () => {
  const custom = (iso: string) => ({
    stepId: "start_date",
    optionId: "custom",
    customValue: iso,
  });
  assertEquals(startPick("monday nov 23", TODAY), custom("2026-11-23"));
  assertEquals(startPick("Nov 23", TODAY), custom("2026-11-23"));
  assertEquals(startPick("23 de noviembre", TODAY), custom("2026-11-23"));
  assertEquals(
    startPick("el lunes 23 de noviembre", TODAY),
    custom("2026-11-23"),
  );
  assertEquals(startPick("2026-11-23", TODAY), custom("2026-11-23"));
  // A model-made year in the past is the next such day, not a past date.
  assertEquals(startPick("2023-11-23", TODAY), custom("2026-11-23"));
  assertEquals(startPick("monday", TODAY), custom("2026-11-16"));
  assertEquals(startPick("tomorrow", TODAY), custom("2026-11-13"));
  assertEquals(startPick("whenever works", TODAY), null);
  assertEquals(startPick("", TODAY), null);
});

Deno.test("REQ-585 durationPick: the half is kept — '2 and a half weeks' / 'dos semanas y media' are 2.5 weeks", () => {
  const custom = (v: string) => ({
    stepId: "wraps",
    optionId: "custom",
    customValue: v,
  });
  assertEquals(durationPick("2 and a half weeks"), custom("2.5 weeks"));
  assertEquals(
    durationPick("its 2 and a half weeks not 2"),
    custom("2.5 weeks"),
  );
  assertEquals(durationPick("dos semanas y media"), custom("2.5 weeks"));
  assertEquals(durationPick("2.5 weeks"), custom("2.5 weeks"));
  assertEquals(durationPick("2 1/2 weeks"), custom("2.5 weeks"));
  assertEquals(durationPick("3 weeks"), custom("3 weeks"));
  assertEquals(durationPick("tres semanas"), custom("3 weeks"));
  assertEquals(durationPick("10 days"), custom("10 days"));
  assertEquals(durationPick("1 week"), custom("1 week"));
  assertEquals(durationPick("TBD"), { stepId: "wraps", optionId: "tbd" });
  assertEquals(durationPick("a while"), null);
});

Deno.test("REQ-585 pickForStep: a value that IS one of the step's presets is that preset", () => {
  assertEquals(
    pickForStep(
      { stepId: "wraps", optionId: "custom", customValue: "2 weeks" },
      step("wraps"),
    ),
    { stepId: "wraps", optionId: "2_weeks" },
  );
  assertEquals(
    pickForStep(
      { stepId: "wraps", optionId: "custom", customValue: "1 day" },
      step("wraps"),
    ),
    { stepId: "wraps", optionId: "1_day" },
  );
  assertEquals(
    pickForStep({
      stepId: "wraps",
      optionId: "custom",
      customValue: "2.5 weeks",
    }, step("wraps")),
    { stepId: "wraps", optionId: "custom", customValue: "2.5 weeks" },
  );
  // An option the step doesn't have is no pick.
  assertEquals(
    pickForStep(
      { stepId: "start_date", optionId: "yesterday" },
      step("start_date"),
    ),
    null,
  );
});

Deno.test("REQ-585 paymentPick: a preset id, or the contractor's words read like the wizard's own prefill", () => {
  assertEquals(paymentPick("50_50"), {
    stepId: "payment_terms",
    optionId: "50_50",
  });
  assertEquals(
    paymentPick("50% deposit upfront, rest when done"),
    { stepId: "payment_terms", optionId: "50_50" },
  );
  assertEquals(paymentPick("30/30/40")?.optionId, "30_30_40");
  assertEquals(paymentPick("due_now")?.optionId, "due_now");
  assertEquals(paymentPick("whatever")?.optionId, undefined);
});

Deno.test("REQ-585 termsPicks: the update_terms values in wizard order, and the ones that could not be read", () => {
  assertEquals(
    termsPicks(
      {
        paymentTerms: "50_50",
        startDate: "monday nov 23",
        duration: "2 and a half weeks",
      },
      TODAY,
    ),
    {
      picks: [
        { stepId: "start_date", optionId: "custom", customValue: "2026-11-23" },
        { stepId: "wraps", optionId: "custom", customValue: "2.5 weeks" },
        { stepId: "payment_terms", optionId: "50_50" },
      ],
      unread: [],
    },
  );
  assertEquals(termsPicks({ startDate: "whenever" }, TODAY), {
    picks: [],
    unread: ["start_date"],
  });
});

Deno.test("REQ-585 mentionedTerms: the start date / time to complete a message asks to change — pair 7's three messages", () => {
  assertEquals(
    mentionedTerms(
      "wait the start should be next week not next month, fix it. and its 2 and a half weeks not 2. also what should I charge for the heated floor normally?",
    ),
    ["start_date", "wraps"],
  );
  assertEquals(
    mentionedTerms(
      "oops no, empezamos la próxima semana, no el próximo mes. y agrega 1,500 por la calefacción del piso",
    ),
    ["start_date"],
  );
  assertEquals(
    mentionedTerms(
      "we start monday nov 23. and I want a 50% deposit upfront, rest when done. is 50% normal in texas?",
    ),
    ["start_date"],
  );
  for (
    const s of [
      "add a plumbing permit line $450",
      "change the cabinet line to just say white shaker cabinets",
      "agrega 1,500 por la calefacción del piso",
      "Kitchen gut, 3 guys x 3 weeks x $65/hr, cabinets $9.5k",
    ]
  ) assertEquals(mentionedTerms(s), [], s);
});

Deno.test("REQ-585 termsChangeLine: says what changed, in the contractor's language", () => {
  const start = step("start_date");
  assertEquals(
    termsChangeLine("en", {
      kind: "answered",
      step: start,
      to: { optionId: "custom", customValue: "2026-11-23" },
    }),
    "Set the start date to Nov 23, 2026.",
  );
  assertEquals(
    termsChangeLine("es", {
      kind: "changed",
      step: start,
      from: { optionId: "next_month" },
      to: { optionId: "next_week" },
    }),
    "Cambié la fecha de inicio: El próximo mes → La próxima semana.",
  );
  assertEquals(
    termsChangeLine("en", {
      kind: "changed",
      step: step("wraps"),
      from: { optionId: "2_weeks" },
      to: { optionId: "custom", customValue: "2.5 weeks" },
    }),
    "Changed the time to complete: 2 weeks → 2.5 weeks.",
  );
  assertStringIncludes(
    termsChangeLine("es", {
      kind: "changed",
      step: step("wraps"),
      from: { optionId: "2_weeks" },
      to: { optionId: "custom", customValue: "2.5 weeks" },
    }),
    "2.5 semanas",
  );
  const later = termsChangeLine("en", {
    kind: "later",
    step: step("payment_terms"),
    to: { optionId: "50_50" },
    prefilled: true,
  });
  assertStringIncludes(later, "50/50");
  assertStringIncludes(later, "payment");
  assertStringIncludes(
    termsChangeLine("en", {
      kind: "same",
      step: start,
      to: { optionId: "next_week" },
    }),
    "already",
  );
});

Deno.test("REQ-585 termsNotAppliedLine: a mentioned start date / time to complete that wasn't applied is said, never passed over", () => {
  assertEquals(termsNotAppliedLine("en", []), "");
  const en = termsNotAppliedLine("en", ["start_date", "wraps"]);
  assertStringIncludes(
    en,
    "didn't change the start date or the time to complete",
  );
  const es = termsNotAppliedLine("es", ["start_date"]);
  assertStringIncludes(es, "No cambié la fecha de inicio");
  assert(!es.includes("start"), es);
});

// ---------------------------------------------------------------------------
// REQ-663 (demo-loop cycle 5, m40 + p18-7c): the model re-sent the job's
// current terms through update_terms on "add $400 change order" — a signed
// agreement answered three "can't change …" lines nobody asked for
// (fleet-0 stdout:254), and an echo said "The payment terms is already
// 50/50." (fleet-6 stdout:331).
// ---------------------------------------------------------------------------

Deno.test("REQ-663 askedTerms: a change-order message names no term — the demo's two messages and pair 7's", () => {
  for (
    const s of [
      "Linda also wants the hallway painted, add $400 change order",
      "add a plumbing permit line $450",
      "change the cabinet line to just say white shaker cabinets",
      "agrega 1,500 por la calefacción del piso",
      "Kitchen gut, cabinets $9.5k",
      "take out the floor stays line and add this to the half bath",
      "send the next version to the customer",
    ]
  ) assertEquals(askedTerms(s), [], s);
  assertEquals(
    askedTerms(
      "also add change order for the Hendersons: heated floor in bath, 64 sqft, about 1200 extra. oh and its NOT done before thanksgiving…fix that",
    ),
    ["start_date", "wraps"],
  );
});

Deno.test("REQ-663 askedTerms: every way a term is asked for is read (loose — it gates the model's picks, so a miss would drop a real edit)", () => {
  const cases: [string, string[]][] = [
    ["we start monday nov 23", ["start_date"]],
    ["make it next week", ["start_date"]],
    ["empezamos la próxima semana", ["start_date"]],
    ["push the start back to the 15th", ["start_date"]],
    ["asap please", ["start_date"]],
    ["its 2 and a half weeks not 2", ["wraps"]],
    ["make it 3 weeks", ["wraps"]],
    ["how long will it take", ["wraps"]],
    ["son 3 semanas", ["wraps"]],
    ["I want a 50% deposit upfront", ["payment_terms"]],
    ["make the payment 50/50", ["payment_terms"]],
    ["half up front", ["payment_terms"]],
    ["net 30", ["payment_terms"]],
    ["que pague la mitad por adelantado", ["payment_terms"]],
    ["el pago todo al final", ["payment_terms"]],
  ];
  for (const [s, ids] of cases) {
    for (const id of ids) assert(askedTerms(s).includes(id as never), s);
  }
});

Deno.test("REQ-663 termsChangeLine: 'already' agrees with a plural term — never 'The payment terms is'", () => {
  const pay = step("payment_terms");
  assertEquals(
    termsChangeLine("en", {
      kind: "same",
      step: pay,
      to: { optionId: "50_50" },
    }),
    "The payment terms are already 50/50.",
  );
  const es = termsChangeLine("es", {
    kind: "same",
    step: pay,
    to: { optionId: "50_50" },
  });
  assertStringIncludes(es, "Las condiciones de pago ya son ");
  assertEquals(
    termsChangeLine("en", {
      kind: "same",
      step: step("wraps"),
      to: { optionId: "custom", customValue: "3 weeks" },
    }),
    "The time to complete is already 3 weeks.",
  );
  assertStringIncludes(
    termsChangeLine("es", {
      kind: "same",
      step: step("start_date"),
      to: { optionId: "next_week" },
    }),
    "La fecha de inicio ya es ",
  );
});
