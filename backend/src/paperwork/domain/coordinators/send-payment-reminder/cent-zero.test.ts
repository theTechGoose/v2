/**
 * REQ-1109 — LOOP-007 cycle 3, q3-35: the invoice text, the reminder email
 * (007), the nudge email (009) and the Remind dialog preview drop the
 * trailing cent zero ("$1,035.5", "$225.3", "$1,000.5"). The backend formats
 * customer-facing money with `minimumFractionDigits: 0, maximumFractionDigits: 2`,
 * which strips trailing zeros one digit at a time. REQ-961 house rule: whole
 * dollars ("$1,000") or full cents ("$1,035.50"), never one decimal place.
 */
import { assert } from "#std/assert";
import { composeReminderCopy } from "./mod.ts";
import { renderInvoiceBody } from "../send-paperwork-sms/mod.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";
import type { Customer } from "@crm/dto/customer.ts";
import type { User } from "@users/dto/user.ts";

const invoice = (amount: number, paidCents = 0) =>
  ({
    id: "inv-1",
    userId: "u-1",
    number: "INV-002",
    customerId: "c-1",
    amount,
    paidCents,
    status: "sent",
    dueDate: "2026-11-19",
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-11-15T00:00:00.000Z",
  }) as unknown as Invoice;

const copyFor = (inv: Invoice, day: 3 | 7 = 3, lang: "en" | "es" = "en") =>
  composeReminderCopy({
    day,
    customerFirst: "Ana",
    senderFirst: "Raph",
    businessName: "Ortega Floors LLC",
    invoice: inv,
    lang,
  });

for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-1109 (LOOP-007 q3-35) reminder ${lang}: a 103550-cent invoice's reminder email and text read $1,035.50, never $1,035.5`, () => {
    const copy = copyFor(invoice(103_550), 3, lang);
    const html = copy.emailHtml("https://x.test/s/abc");
    const sms = copy.smsBody("https://x.test/s/abc");
    assert(html.includes("$1,035.50"), `the reminder email drops the cent zero: ${html.match(/\$[\d,.]+/g)?.join(" ")}`);
    assert(sms.includes("$1,035.50 (INV-"), `the reminder text drops the cent zero: "${sms}"`);
  });
}

Deno.test("REQ-1109 (LOOP-007 q3-35) nudge: a part-paid invoice with a $225.30 balance asks for $225.30, never $225.3", () => {
  const copy = copyFor(invoice(72_530, 50_000), 7);
  const html = copy.emailHtml("");
  const sms = copy.smsBody("");
  assert(html.includes("$225.30"), `the nudge email reads ${html.match(/\$[\d,.]+/g)?.join(" ")}`);
  assert(sms.includes("$225.30"), `the nudge text reads "${sms}"`);
});

Deno.test("REQ-1109 (LOOP-007 q3-35) reminder: whole dollars stay whole — $1,000, not $1,000.00", () => {
  const copy = copyFor(invoice(100_000));
  const html = copy.emailHtml("");
  assert(html.includes("$1,000"), `the reminder names $1,000: ${html.match(/\$[\d,.]+/g)?.join(" ")}`);
  assert(!html.includes("$1,000.00"), "whole dollars are printed without cents");
});

Deno.test("REQ-1109 (LOOP-007 q3-35) invoice SMS: a 100050-cent invoice text reads 'your invoice is ready ($1,000.50)', never $1,000.5", () => {
  const body = renderInvoiceBody(
    invoice(100_050),
    { id: "c-1", name: "Ana Ruiz" } as unknown as Customer,
    { id: "u-1", name: "Raph Castro" } as unknown as User,
    "https://x.test/s/abc",
    "en",
  );
  assert(body.includes("($1,000.50)"), `the invoice text drops the cent zero: "${body}"`);
});

Deno.test("REQ-1109 (LOOP-007 q3-35) no paperwork money formatter (what the customer and owner read) strips the trailing cent zero (minimumFractionDigits: 0 with maximumFractionDigits: 2)", async () => {
  // backend/src/paperwork/ — the LLM prompt price lines under agents/ are not customer copy
  const root = new URL("../../../", import.meta.url);
  const offenders: string[] = [];
  const walk = async (dir: URL) => {
    for await (const e of Deno.readDir(dir)) {
      const u = new URL(e.name + (e.isDirectory ? "/" : ""), dir);
      if (e.isDirectory) await walk(u);
      else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) {
        const src = await Deno.readTextFile(u);
        const re = /minimumFractionDigits:\s*0\s*,[\s\n]*maximumFractionDigits:\s*2/g;
        if (re.test(src)) offenders.push(u.pathname.slice(root.pathname.length));
      }
    }
  };
  await walk(root);
  assert(offenders.length === 0, `formatters that print "$X.5": ${offenders.join(", ")}`);
});
