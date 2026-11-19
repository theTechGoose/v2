/**
 * REQ-1130 (LOOP-007 q3, q3-59) — Raphael: "test every single aspect of this
 * application … one Opus agent per issue to do root cause analysis, then one
 * to write the test, then one to fix it and make it green."
 *
 * The overpaid line the paid email and the invoice PDF print came from
 * WORDS.overpaid: "Overpaid by {amount} — we will refund or credit this"
 * (es: "… lo reembolsaremos o acreditaremos"). That is a promise made in the
 * contractor's voice that the owner never made (REQ-202 only asks to flag the
 * overpayment), and /i says just "Overpaid by {amount}" (public.doc.overpaid).
 * The line must flag the amount and nothing more, in the same words as /i.
 */
import { assert, assertEquals } from "#std/assert";
import { paymentStateLines } from "./mod.ts";
import { t } from "@core/i18n/mod.ts";

// the tester's numbers: $1,100 cash on a $1,035.50 invoice
const INVOICE = { status: "paid", amount: 103_550, paidCents: 110_000 };
const OVER = "$64.50";
const PROMISE = /refund|credit|reembols|acredit/i;

for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-1130 (q3-59) paymentStateLines ${lang}: an overpayment is flagged without a refund-or-credit promise`, () => {
    const { overpaid } = paymentStateLines(INVOICE, lang);
    assert(overpaid, "an overpayment is still flagged (REQ-202)");
    assert(overpaid.includes(OVER), `names ${OVER}, got "${overpaid}"`);
    assert(!PROMISE.test(overpaid), `${lang}: promises a refund or credit on the owner's behalf: "${overpaid}"`);
  });

  Deno.test(`REQ-1130 (q3-59) paymentStateLines ${lang}: the overpaid line reads the same as /i's public.doc.overpaid`, () => {
    const { overpaid } = paymentStateLines(INVOICE, lang);
    assertEquals(overpaid, t(lang, "public.doc.overpaid", { amount: OVER }));
  });
}
