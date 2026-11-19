/**
 * REQ-1028 — LOOP-007 cycle 2, q2-9: a payment reminder for a part-paid
 * invoice asks for the full total. composeReminderCopy prints
 * `invoice.amount` and never subtracts `paidCents`, so a $1,190.75 invoice
 * with $500 paid asks the customer for $1,190.75 instead of $690.75.
 */
import { assert } from "#std/assert";
import { composeReminderCopy } from "./mod.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";

const inv = {
  id: "inv-1",
  userId: "u-1",
  number: "INV-001",
  customerId: "c-1",
  amount: 119_075,
  paidCents: 50_000,
  status: "pending",
  dueDate: "2026-11-01",
  createdAt: "2026-10-20T00:00:00.000Z",
  updatedAt: "2026-11-15T00:00:00.000Z",
} as unknown as Invoice;

for (const lang of ["es", "en"] as const) {
  Deno.test(`REQ-1028 (LOOP-007 q2-9) reminder ${lang}: a part-paid invoice's reminder email and text ask for the $690.75 balance, not $1,190.75`, () => {
    const copy = composeReminderCopy({
      day: 3,
      customerFirst: "María",
      senderFirst: "Raph",
      businessName: "Pisos Ortega LLC",
      invoice: inv,
      lang,
    });
    const html = copy.emailHtml("https://x.test/i/inv-1");
    const sms = copy.smsBody("https://x.test/i/inv-1");
    assert(!html.includes("$1,190.75"), `the reminder email asks for the full $1,190.75`);
    assert(html.includes("$690.75"), `the reminder email never names the $690.75 balance`);
    assert(!sms.includes("$1,190.75"), `the reminder text asks for the full $1,190.75: "${sms}"`);
  });
}
