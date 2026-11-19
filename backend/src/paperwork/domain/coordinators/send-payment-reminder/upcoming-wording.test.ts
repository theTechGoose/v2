/**
 * REQ-1115 — Raphael (LOOP-007): "test every single aspect of this
 * application … one Opus agent per issue to do root cause analysis, then one
 * to write the test, then one to fix it and make it green." Cycle 3, issue
 * q3-39: "Reminder says 'vence pronto' for a bill due in 30 days".
 *
 * A manual nudge before the due date is always step -3
 * (`manualReminderDay`), and `composeReminderCopy` picks its wording from the
 * step alone: "is due soon" / "vence pronto" and the "Coming up" /
 * "Próximo vencimiento" subject — copy written for the sweep step that fires
 * three days before the due date. A reminder sent a month early must not say
 * "due soon"; it names the due date instead. Three days out it still does.
 *
 * `now` is the reminder's send time (the fix threads it into the copy).
 */
import { assert, assertStringIncludes } from "#std/assert";
import { composeReminderCopy } from "./mod.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";

const DUE = "2026-12-19";

function inv(): Invoice {
  return {
    id: "i-1",
    userId: "u-1",
    quoteId: "q-1",
    dueDate: DUE,
    amount: 820_67,
    status: "sent",
    createdAt: "2026-11-19T00:00:00Z",
    updatedAt: "2026-11-19T00:00:00Z",
  };
}

// Built as a variable so the extra `now` (the fix's new input) is accepted by
// today's signature too.
function copyAt(lang: "en" | "es", now: Date) {
  const opts = {
    day: -3 as const,
    customerFirst: "Lucía",
    senderFirst: "Marco",
    businessName: "Ortiz Painting & Fence",
    invoice: inv(),
    lang,
    now,
  };
  return composeReminderCopy(opts);
}

const MONTH_EARLY = new Date("2026-11-19T15:00:00Z"); // 30 days before DUE
const THREE_DAYS = new Date("2026-12-16T15:00:00Z"); // 3 days before DUE

Deno.test("REQ-1115 (LOOP-007 q3-39): a Spanish reminder sent 30 days before the due date does not say 'vence pronto' / 'Próximo vencimiento'", () => {
  const c = copyAt("es", MONTH_EARLY);
  const html = c.emailHtml("");
  const sms = c.smsBody("");
  assert(!/vence pronto/i.test(html), `email body says "vence pronto" 30 days out: ${html.match(/<p[^>]*>[^<]*vence pronto[^<]*<\/p>/)?.[0]}`);
  assert(!/vence pronto/i.test(sms), `SMS says "vence pronto" 30 days out: ${sms}`);
  assert(!/Próximo vencimiento/i.test(c.emailSubject), `subject says "Próximo vencimiento" 30 days out: ${c.emailSubject}`);
});

Deno.test("REQ-1115 (LOOP-007 q3-39): an English reminder sent 30 days before the due date does not say 'is due soon' / 'Coming up'", () => {
  const c = copyAt("en", MONTH_EARLY);
  const sms = c.smsBody("");
  assert(!/due soon/i.test(c.emailHtml("")), "email body says 'is due soon' 30 days out");
  assert(!/due soon/i.test(sms), `SMS says 'is due soon' 30 days out: ${sms}`);
  assert(!/^Coming up/i.test(c.emailSubject), `subject says 'Coming up' 30 days out: ${c.emailSubject}`);
});

Deno.test("REQ-1115 (LOOP-007 q3-39): the month-early reminder's wording names when it is due (the SMS carries the due date)", () => {
  // The email already has a "· Vence <date>" line; the SMS has only the tone,
  // so the tone must say when it is due rather than "soon".
  for (const lang of ["en", "es"] as const) {
    const sms = copyAt(lang, MONTH_EARLY).smsBody("");
    assert(
      /19|Dec|dic/i.test(sms.replace(/\$[\d,.]+/, "")),
      `${lang} SMS 30 days out names the due date (got "${sms}")`,
    );
  }
});

Deno.test("REQ-1115 (LOOP-007 q3-39): three days before the due date the reminder still says 'vence pronto' / 'is due soon' (REQ-704 copy kept)", () => {
  assertStringIncludes(copyAt("es", THREE_DAYS).smsBody(""), "vence pronto");
  assertStringIncludes(copyAt("es", THREE_DAYS).emailSubject, "Próximo vencimiento");
  assertStringIncludes(copyAt("en", THREE_DAYS).smsBody(""), "is due soon");
});
