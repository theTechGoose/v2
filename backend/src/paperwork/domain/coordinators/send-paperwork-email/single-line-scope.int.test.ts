/**
 * REQ-946 — LOOP-007 cycle 1, issue q1-19 ("Single-line quote email has no
 * work description, though its intro promises line items below"). Through the
 * real send flow: an assistant-style quote (scope in its one qty-1 line, no
 * `description`) is emailed, and the captured htmlBody must name the work.
 */
import { assert } from "#std/assert";
import { SendPaperworkEmail } from "./mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
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

const LINE = "Cambio de piso de cocina";

async function setup(lang: "en" | "es") {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const customers = new CustomerStore();
  const quotes = new QuoteStore();
  const invoices = new InvoiceStore();
  const identities = new BusinessIdentityStore();
  const email = new EmailService();
  const sent: SendEmailInput[] = [];
  email.send = (input: SendEmailInput) => {
    sent.push(input);
    return Promise.resolve({ ok: true, reason: "test_capture" });
  };
  const flow = new SendPaperworkEmail(
    quotes,
    invoices,
    customers,
    new UserStore(),
    identities,
    email,
    new LogPaperworkMessage(
      new CommConversationStore(),
      new CommMessageStore(),
    ),
  );
  const now = new Date().toISOString();
  await (await getKv()).set(["user", "u-1"], {
    id: "u-1",
    phoneNumber: "+15125550000",
    name: "Test Contractor",
    email: "me@test.dev",
    createdAt: now,
    updatedAt: now,
  });
  await identities.upsert("u-1", {
    businessName: "Pisos Ortega LLC",
    commsLanguage: lang,
  });
  const customer = await customers.create("u-1", {
    name: "María López",
    email: "maria@acme.test",
  });
  // assistant / quick-quote shape: the scope lives in the one line, no description
  const quote = await quotes.create("u-1", {
    customerId: customer.id,
    summary: "Kitchen",
    lineItems: [{
      description: LINE,
      quantity: 1,
      unit: "job",
      price: 345_000,
    }],
    estimatedTotal: 345_000,
  });
  return { flow, quote, invoices, customer, sent };
}

for (const lang of ["es", "en"] as const) {
  Deno.test(`REQ-946 (q1-19) send-paperwork-email ${lang}: the sent quote email of a one-line qty-1 quote with no description names its work`, async () => {
    const { flow, quote, sent } = await setup(lang);
    const r = await flow.run("u-1", { kind: "quote", resourceId: quote.id });
    assert(r.ok, `send failed: ${JSON.stringify(r)}`);
    const html = sent[0].htmlBody;
    assert(
      html.includes(t(lang, "paperworkEmail.quote.introTail")),
      "the intro promises the line items below",
    );
    assert(
      html.includes(LINE),
      `the sent quote email never names the work "${LINE}"`,
    );
    assert(
      html.includes(t(lang, "paperworkEmail.quote.whatWeHandle")),
      "the sent quote email has no line-item block",
    );
  });

  Deno.test(`REQ-946 (q1-19) send-paperwork-email ${lang}: the sent invoice email of that quote names its work`, async () => {
    const { flow, quote, invoices, customer, sent } = await setup(lang);
    const inv = await invoices.create("u-1", {
      quoteId: quote.id,
      customerId: customer.id,
      amount: 345_000,
    } as never);
    const r = await flow.run("u-1", { kind: "invoice", resourceId: inv.id });
    assert(r.ok, `send failed: ${JSON.stringify(r)}`);
    assert(
      sent[0].htmlBody.includes(LINE),
      `the sent invoice email never names the work "${LINE}"`,
    );
  });
}
