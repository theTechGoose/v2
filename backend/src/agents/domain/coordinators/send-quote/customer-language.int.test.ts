/**
 * REQ-715 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 5, issue m31 "No per-client language" (with c2-M29,
 * c3-m43, c4-M34). SendQuote records the language each send went out in on
 * `quote.lastDelivery.lang` and the divider (REQ-586) — every in-app customer
 * link carries it as `?lang=`. It resolved that language as the per-send pick
 * → the ACCOUNT default → en, so a quote sent to Carmen (who reads Spanish)
 * with no pick was recorded, emailed and linked in English.
 *
 * Integration: the real SendQuote → SendPaperworkEmail on an in-memory KV;
 * only the email provider is captured.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { SendQuote } from "./mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import type { CreateCustomerDto } from "@crm/dto/customer.ts";
import { SendPaperworkEmail } from "@paperwork/domain/coordinators/send-paperwork-email/mod.ts";
import { SendPaperworkSms } from "@paperwork/domain/coordinators/send-paperwork-sms/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import { ShortLinkStore } from "@paperwork/domain/data/shortlink-store/mod.ts";
import {
  EmailService,
  type SendEmailInput,
} from "@communication/domain/data/email-service/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { ConversationStore as CommConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore as CommMessageStore } from "@communication/domain/data/message-store/mod.ts";

const USER = "u-req715-send";

async function rig() {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  await resetKv();
  const conversations = new AgentConversationStore();
  const quotes = new QuoteStore();
  const invoices = new InvoiceStore();
  const customers = new CustomerStore();
  const users = new UserStore();
  const identity = new BusinessIdentityStore();
  const emails: SendEmailInput[] = [];
  const email = new EmailService();
  email.send = (input: SendEmailInput) => {
    emails.push(input);
    return Promise.resolve({ ok: true, reason: "test_capture" });
  };
  const log = () =>
    new LogPaperworkMessage(
      new CommConversationStore(),
      new CommMessageStore(),
    );
  const flow = new SendQuote(
    conversations,
    new AgentMessageStore(),
    quotes,
    new EventBus(),
    new SendPaperworkEmail(
      quotes,
      invoices,
      customers,
      users,
      identity,
      email,
      log(),
    ),
    new SendPaperworkSms(
      quotes,
      invoices,
      customers,
      users,
      identity,
      new SmsService(),
      new ShortLinkStore(),
      log(),
    ),
    users,
    undefined,
    customers,
  );
  const kv = await getKv();
  const now = new Date().toISOString();
  await kv.set(["user", USER], {
    id: USER,
    phoneNumber: "+15125557300",
    name: "Luis Ortega",
    email: "luis@test.dev",
    language: "en",
    createdAt: now,
    updatedAt: now,
  });
  // the account's own send default is English
  await identity.upsert(USER, {
    businessName: "Ortega Handyman Services",
    commsLanguage: "en",
  });
  const carmen = await customers.create(USER, {
    name: "Carmen Ruiz",
    email: "carmen@example.com",
    language: "es",
  } as CreateCustomerDto);
  const quote = await quotes.create(USER, {
    customerId: carmen.id,
    summary: "Faucet repair and 2 interior doors",
    jobName: "Faucet Repair",
    jobNameByLang: { en: "Faucet Repair", es: "Reparación de grifo" },
    lineItems: [{
      description: "Faucet + 2 doors",
      quantity: 1,
      unit: "ea",
      price: 450_00,
    }],
    estimatedTotal: 450_00,
    status: "draft",
  });
  const conv = await conversations.create({
    userId: USER,
    quoteId: quote.id,
    customerId: carmen.id,
  });
  return { flow, quotes, emails, conv, quote };
}

Deno.test("REQ-715 m31 send-quote: with no pick, a quote to a Spanish-speaking customer goes out, is recorded and links in Spanish", async () => {
  const r = await rig();
  try {
    const out = await r.flow.run({
      userId: USER,
      conversationId: r.conv.id,
      quoteId: r.quote.id,
      channel: "email",
    });
    const stored = await r.quotes.getOwned(r.quote.id, USER);
    assertEquals(stored.lastDelivery?.lang, "es", "recorded in her language");
    assertEquals((out.newMessages[0].payload as { lang?: string }).lang, "es");
    assertEquals(r.emails.length, 1);
    assert(
      r.emails[0].subject.startsWith("Cotización "),
      `the email is Spanish: ${r.emails[0].subject}`,
    );
    assertStringIncludes(r.emails[0].htmlBody, `/q/${r.quote.id}?lang=es`);
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-715 m31 send-quote: a per-send pick still wins over the customer's language", async () => {
  const r = await rig();
  try {
    await r.flow.run({
      userId: USER,
      conversationId: r.conv.id,
      quoteId: r.quote.id,
      channel: "email",
      language: "en",
    });
    const stored = await r.quotes.getOwned(r.quote.id, USER);
    assertEquals(stored.lastDelivery?.lang, "en");
    assert(
      r.emails[0].subject.startsWith("Quote "),
      `the pick wins: ${r.emails[0].subject}`,
    );
  } finally {
    await resetKv();
  }
});
