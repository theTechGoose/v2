/**
 * REQ-699 (demo-loop cycle 5, M20) — what signing a RECURRING quote bills.
 * Pair 2's "$180 al mes" was signed and billed as a one-time $180 (INV-001,
 * fleet-1 stdout:405): SendSignedConfirmation turned every payment term into
 * milestone invoices. A recurring term bills through the Field subscription
 * the signature makes (paperwork asks Field through QuoteSubscriptionPort,
 * because Field imports paperwork), never as a one-off milestone. With no
 * subscription made (Field not booted, no customer), the period is billed
 * once, as before — accept always bills (REQ-240).
 */
import { assert, assertEquals } from "#std/assert";
import { SendSignedConfirmation } from "./mod.ts";
import {
  type QuoteSubscriptionEvent,
  QuoteSubscriptionPort,
} from "@paperwork/domain/coordinators/quote-subscription-port/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import {
  EmailService,
  type SendEmailInput,
} from "@communication/domain/data/email-service/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import { RenderQuotePdf } from "@paperwork/domain/coordinators/render-quote-pdf/mod.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { ConversationStore as CommConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore as CommMessageStore } from "@communication/domain/data/message-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

const U = "u-699";

function rig(port?: QuoteSubscriptionPort) {
  const quotes = new QuoteStore();
  const invoices = new InvoiceStore();
  const customers = new CustomerStore();
  const email = new EmailService();
  const mails: SendEmailInput[] = [];
  email.send = (m: SendEmailInput) => {
    mails.push(m);
    return Promise.resolve({ ok: true, messageId: "m-699" });
  };
  const sms = new SmsService();
  sms.send = () => Promise.resolve({ ok: true, sid: "SM-699" });
  const commsLog = new LogPaperworkMessage(
    new CommConversationStore(),
    new CommMessageStore(),
  );
  commsLog.run = () => Promise.resolve(undefined);
  const flow = new SendSignedConfirmation(
    quotes,
    invoices,
    customers,
    new UserStore(),
    new BusinessIdentityStore(),
    new RenderQuotePdf(),
    email,
    sms,
    commsLog,
    port,
  );
  return { flow, quotes, invoices, customers, mails };
}

async function signed(r: ReturnType<typeof rig>, payment: string) {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const maria = await r.customers.create(U, {
    name: "María López",
    email: "maria@example.com",
  });
  return await r.quotes.create(U, {
    summary: "Corte de césped y poda de setos",
    jobName: "Corte de césped",
    customerId: maria.id,
    lineItems: [],
    estimatedTotal: 18_000,
    terms: [
      { stepId: "start_date", label: "Start", value: "Next week" },
      { stepId: "payment_terms", label: "Payment", value: payment },
    ],
    status: "accepted",
    acceptedAt: new Date().toISOString(),
  });
}

/** a port Field would have registered on, recording what it is asked */
function fieldPort(answer: { subscriptionId: string } | null) {
  const port = new QuoteSubscriptionPort();
  const asked: QuoteSubscriptionEvent[] = [];
  port.register((e) => {
    asked.push(e);
    return Promise.resolve(answer);
  });
  return { port, asked };
}

const billedFor = async (r: ReturnType<typeof rig>, quoteId: string) =>
  (await r.invoices.listByUser(U)).filter((i) => i.quoteId === quoteId);

Deno.test("REQ-699 M20 signing a monthly quote bills NO one-off invoice — Field's subscription bills each period", async () => {
  const { port, asked } = fieldPort({ subscriptionId: "sub-1" });
  const r = rig(port);
  const quote = await signed(r, "Monthly · $180/mo");

  const res = await r.flow.run(quote.id);

  assertEquals(asked, [{ userId: U, quoteId: quote.id }]);
  assertEquals(await billedFor(r, quote.id), [], "no INV-001 for $180");
  assertEquals(res.ok, true);
  assertEquals(res.invoiceId, undefined);
  assertEquals(res.subscriptionId, "sub-1");
  // the customer's confirmation names the recurring charge, not a first invoice
  assertEquals(r.mails.length, 1);
  assert(
    r.mails[0].htmlBody.includes("Monthly · $180/mo"),
    "the email names the recurring charge",
  );
  assert(!r.mails[0].htmlBody.includes("Pay the first invoice"));
  // replay-safe: the stamp stops a second run before it asks again
  await r.flow.run(quote.id);
  assertEquals(asked.length, 1);
});

Deno.test("REQ-699 a one-off quote never asks Field — its milestones bill as before", async () => {
  const { port, asked } = fieldPort({ subscriptionId: "never" });
  const r = rig(port);
  const quote = await signed(r, "50/50");
  const res = await r.flow.run(quote.id);
  assertEquals(asked, []);
  assertEquals((await billedFor(r, quote.id)).length, 2);
  assertEquals(res.subscriptionId, undefined);
});

Deno.test("REQ-699 no subscription made (paperwork alone, or Field declined) → the period is billed once, as before", async () => {
  for (const port of [new QuoteSubscriptionPort(), fieldPort(null).port]) {
    const r = rig(port);
    const quote = await signed(r, "Monthly · $180/mo");
    const res = await r.flow.run(quote.id);
    const billed = await billedFor(r, quote.id);
    assertEquals(billed.map((i) => i.amount), [18_000]);
    assertEquals(res.invoiceId, billed[0].id);
    assertEquals(res.subscriptionId, undefined);
  }
});
