/**
 * REQ-1130 (LOOP-007 q3, q3-59) — Raphael: "test every single aspect of this
 * application … one Opus agent per issue to do root cause analysis, then one
 * to write the test, then one to fix it and make it green."
 *
 * Through the real path: a $1,035.50 invoice, $1,100 cash recorded and run
 * through ComputeInvoiceBalance (status "paid", overpaidCents 6450), then
 * SendPaperworkEmail for the invoice (the paid email, 010-email). The
 * [data-overpaid] line must read "Overpaid by $64.50" like /i — never
 * "— we will refund or credit this", a promise the owner never made.
 */
import { assert, assertEquals } from "#std/assert";
import { SendPaperworkEmail } from "./mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { PaymentStore } from "@paperwork/domain/data/payment-store/mod.ts";
import { ComputeInvoiceBalance } from "@paperwork/domain/coordinators/compute-invoice-balance/mod.ts";
import type { MarkInvoicePaid } from "@paperwork/domain/coordinators/mark-invoice-paid/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import {
  EmailService,
  type SendEmailInput,
} from "@communication/domain/data/email-service/mod.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { ConversationStore as CommConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore as CommMessageStore } from "@communication/domain/data/message-store/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";
import { t } from "@core/i18n/mod.ts";

const TOTAL = 103_550; // $1,035.50
const CASH = 110_000; // $1,100.00
const OVER = "$64.50";
const PROMISE = /refund|credit|reembols|acredit/i;

async function overpaidAndSent(lang: "en" | "es") {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const customers = new CustomerStore();
  const invoices = new InvoiceStore();
  const payments = new PaymentStore();
  const identities = new BusinessIdentityStore();
  const email = new EmailService();
  const sent: SendEmailInput[] = [];
  email.send = (input: SendEmailInput) => {
    sent.push(input);
    return Promise.resolve({ ok: true, reason: "test_capture" });
  };
  const flow = new SendPaperworkEmail(
    new QuoteStore(),
    invoices,
    customers,
    new UserStore(),
    identities,
    email,
    new LogPaperworkMessage(new CommConversationStore(), new CommMessageStore()),
  );
  const markPaid = { run: () => Promise.resolve() } as unknown as MarkInvoicePaid;
  const balance = new ComputeInvoiceBalance(invoices, payments, markPaid);
  const now = new Date().toISOString();
  await (await getKv()).set(["user", "u-1"], {
    id: "u-1",
    phoneNumber: "+15125550000",
    name: "Test Contractor",
    email: "me@test.dev",
    createdAt: now,
    updatedAt: now,
  });
  await identities.upsert("u-1", { businessName: "Ortega Floors LLC", commsLanguage: lang });
  const customer = await customers.create("u-1", { name: "Maria Lopez", email: "maria@acme.test" });
  const inv = await invoices.create("u-1", {
    jobName: "Kitchen floor",
    customerId: customer.id,
    amount: TOTAL,
    status: "sent",
    issuedDate: "2026-11-10",
    dueDate: "2099-12-31",
  } as never);
  await payments.create("u-1", {
    invoiceId: inv.id,
    amount: CASH,
    method: "cash",
    receivedAt: "2026-11-15T00:00:00.000Z",
  });
  const b = await balance.run(inv.id, "u-1");
  assertEquals(b.status, "paid", "setup: $1,100 on $1,035.50 closes the bill");
  assertEquals(b.overpaidCents, CASH - TOTAL, "setup: $64.50 over");
  const out = await flow.run("u-1", { kind: "invoice", resourceId: inv.id, language: lang });
  assert(out.ok, `send failed: ${JSON.stringify(out)}`);
  return sent[0].htmlBody;
}

function overpaidLineOf(html: string): string {
  const m = html.match(/<div data-overpaid[^>]*>([^<]*)<\/div>/);
  assert(m, "the paid email flags the overpayment (REQ-202)");
  return m[1].replaceAll("&mdash;", "—").replaceAll("&#8212;", "—").trim();
}

for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-1130 (q3-59) ${lang}: the paid email of an overpaid invoice flags ${OVER} without promising a refund or credit`, async () => {
    try {
      const html = await overpaidAndSent(lang);
      const line = overpaidLineOf(html);
      assert(!PROMISE.test(line), `${lang}: [data-overpaid] promises a refund or credit: "${line}"`);
      assertEquals(line, t(lang, "public.doc.overpaid", { amount: OVER }), "reads the same as /i");
    } finally {
      await resetKv();
    }
  });
}
