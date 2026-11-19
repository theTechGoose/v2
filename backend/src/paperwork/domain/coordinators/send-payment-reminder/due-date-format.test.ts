/**
 * REQ-1111 — LOOP-007 cycle 3, q3-36: reminder and nudge emails print the
 * raw ISO due date ("· Due 2026-11-19" / "· Vence 2026-12-19") while every
 * other paperwork email uses the long form ("November 19, 2026" /
 * "19 de noviembre de 2026"). composeReminderCopy passes the stored
 * `invoice.dueDate` straight into `paymentReminder.dueSuffix`.
 */
import { assert } from "#std/assert";
import { composeReminderCopy } from "./mod.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";

const inv = {
  id: "inv-1",
  userId: "u-1",
  number: "INV-001",
  customerId: "c-1",
  amount: 103_550,
  status: "sent",
  dueDate: "2026-11-19",
  createdAt: "2026-10-20T00:00:00.000Z",
  updatedAt: "2026-11-15T00:00:00.000Z",
} as unknown as Invoice;

const URL = "https://x.test/s/abc123?lang=xx&d=2026-01-01";
const ISO = /\d{4}-\d{2}-\d{2}/;

const LONG = {
  en: "November 19, 2026",
  es: "19 de noviembre de 2026",
} as const;

// before-due, due-today, day3, day7 and the day-14 nudge all share one line
for (const lang of ["en", "es"] as const) {
  for (const day of [-3, 0, 3, 7, 14] as const) {
    Deno.test(`REQ-1111 (LOOP-007 q3, q3-36) reminder ${lang} day ${day}: the email names the due date as "${LONG[lang]}", never the ISO 2026-11-19`, () => {
      const copy = composeReminderCopy({
        day,
        customerFirst: "Dana",
        senderFirst: "Raph",
        businessName: "Ortega Floors LLC",
        invoice: inv,
        lang,
      });
      const html = copy.emailHtml(URL);
      const withoutUrl = html.split(URL).join("");
      const dueLine = withoutUrl.match(/(?:Due|Vence)[^<]*/)?.[0] ??
        "(no due line)";
      assert(
        !ISO.test(withoutUrl),
        `the ${lang} reminder email prints a raw ISO date: "${dueLine}"`,
      );
      assert(
        withoutUrl.includes(LONG[lang]),
        `the ${lang} reminder email never names "${
          LONG[lang]
        }" (got "${dueLine}")`,
      );
    });
  }
}
