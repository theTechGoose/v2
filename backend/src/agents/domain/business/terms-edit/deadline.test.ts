/**
 * REQ-653 (demo-loop cycle 5, m50) — "finish before Thanksgiving" is a
 * schedule, not scope. The agreement read "Terminar antes de Acción de
 * Gracias" next to start "De inmediato" + "Estimado 3 semanas" (Nov 12 + 3
 * weeks = Dec 3, after Thanksgiving Nov 26), and "its NOT done before
 * thanksgiving if we start now + 3 wks, fix that" got "I didn't change the
 * start date — ask me again" (fleet-6 stdout:207/225).
 *
 * The pure rules: the deadline a message names (a date, a holiday), whether
 * the terms' start + time to complete reach it, and the reply line.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { deadlineCheck, deadlineLine, readDeadline } from "./mod.ts";

/** Thursday, Nov 12 2026 — the demo's day. */
const TODAY = new Date(2026, 10, 12);

Deno.test("REQ-653 readDeadline: the demo's words name Thanksgiving 2026 (Nov 26), before it", () => {
  for (
    const s of [
      "oh and its NOT done before thanksgiving if we start now + 3 wks, fix that",
      "client wants done before thanksgiving",
      "Finish before Thanksgiving",
      "Terminar antes de Acción de Gracias",
    ]
  ) {
    assertEquals(
      readDeadline(s, TODAY),
      { iso: "2026-11-26", before: true },
      s,
    );
  }
});

Deno.test("REQ-653 readDeadline: dates and other holidays; 'by' includes the day", () => {
  assertEquals(readDeadline("needs to be finished by Dec 5", TODAY), {
    iso: "2026-12-05",
    before: false,
  });
  assertEquals(readDeadline("listo para el 20 de noviembre", TODAY), {
    iso: "2026-11-20",
    before: false,
  });
  assertEquals(readDeadline("done before christmas", TODAY), {
    iso: "2026-12-25",
    before: true,
  });
  // an update_terms finishBy value is a deadline on its own (bare)
  assertEquals(readDeadline("2026-12-01", TODAY, true)?.iso, "2026-12-01");
  assertEquals(readDeadline("Thanksgiving", TODAY, true)?.iso, "2026-11-26");
  assertEquals(readDeadline("before thanksgiving", TODAY, true), {
    iso: "2026-11-26",
    before: true,
  });
  // a bare holiday in a chat message is not a deadline
  assertEquals(readDeadline("we're closed on thanksgiving", TODAY), null);
});

Deno.test("REQ-653 readDeadline: no deadline in scope or start talk", () => {
  for (
    const s of [
      "grout done by hand",
      "we start monday nov 23",
      "complete kitchen remodel",
      "add a heated floor, 64 sqft, about 1200 extra",
    ]
  ) {
    assertEquals(readDeadline(s, TODAY), null, s);
  }
});

const TERMS = [
  { stepId: "start_date", value: "Right away" },
  { stepId: "wraps", value: "3 weeks" },
];

Deno.test("REQ-653 deadlineCheck: Right away + 3 weeks ends Dec 3 — after Thanksgiving", () => {
  const c = deadlineCheck(
    { iso: "2026-11-26", before: true },
    { terms: TERMS, today: TODAY },
  );
  assertEquals(c, { end: "2026-12-03", late: true });
});

Deno.test("REQ-653 deadlineCheck: 1 week from now makes it; no time to complete → null", () => {
  assertEquals(
    deadlineCheck({ iso: "2026-11-26", before: true }, {
      terms: [TERMS[0], { stepId: "wraps", value: "1 week" }],
      today: TODAY,
    }),
    { end: "2026-11-19", late: false },
  );
  assertEquals(
    deadlineCheck({ iso: "2026-11-26", before: true }, {
      terms: [TERMS[0]],
      today: TODAY,
    }),
    null,
  );
  // "by" Nov 19 includes Nov 19; "before" Nov 19 does not
  const t1 = {
    terms: [TERMS[0], { stepId: "wraps", value: "1 week" }],
    today: TODAY,
  };
  assertEquals(
    deadlineCheck({ iso: "2026-11-19", before: false }, t1)?.late,
    false,
  );
  assertEquals(
    deadlineCheck({ iso: "2026-11-19", before: true }, t1)?.late,
    true,
  );
});

Deno.test("REQ-653 deadlineLine: a late schedule is said, with what to change — en + es", () => {
  const en = deadlineLine(
    "en",
    { iso: "2026-11-26", before: true },
    { end: "2026-12-03", late: true },
    TERMS,
  );
  assertStringIncludes(en, "Right away");
  assertStringIncludes(en, "3 weeks");
  assertStringIncludes(en, "Dec 3, 2026");
  assertStringIncludes(en, "Nov 26, 2026");
  assert(/earlier start|shorter time/.test(en), en);
  const es = deadlineLine(
    "es",
    { iso: "2026-11-26", before: true },
    { end: "2026-12-03", late: true },
    TERMS,
  );
  assertStringIncludes(es, "De inmediato");
  assertStringIncludes(es, "3 semanas");
  assertStringIncludes(es, "fecha límite");
  const fits = deadlineLine(
    "en",
    { iso: "2026-11-26", before: true },
    { end: "2026-11-19", late: false },
    [TERMS[0], { stepId: "wraps", value: "1 week" }],
  );
  assertStringIncludes(fits, "in time");
});
