/**
 * REQ-784 — Raphael: "And yes to a sent message outbox." Demo-loop cycle
 * dv1, issue d12: the outbox lists every email and text that went to a
 * customer, with "not texted" and why when one didn't go.
 *
 * A text to a number that can't take one is SKIPPED before dispatch on an
 * email + text send (REQ-764 SendQuote, REQ-770 the chat's invoice send) —
 * so it never reaches SendPaperworkSms.run. The skip must still land in the
 * outbox as "not sent: the number can't receive texts", next to the email
 * that went.
 *
 * Integration: the real coordinators and stores on an in-memory KV; only
 * the email/SMS providers are captured.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { SendQuote } from "./mod.ts";
import { ChatBilling } from "../chat-billing/mod.ts";
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
import { ShortLinkStore } from "@paperwork/domain/data/shortlink-store/mod.ts";
import { type SendSmsInput, SmsService } from "@users/domain/data/sms/mod.ts";
import {
  EmailService,
  type SendEmailInput,
} from "@communication/domain/data/email-service/mod.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { ConversationStore as CommConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore as CommMessageStore } from "@communication/domain/data/message-store/mod.ts";
import { OutboxStore } from "@communication/domain/data/outbox-store/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";

const USER = "u-req784-agents";

function rig() {
  const conversations = new AgentConversationStore();
  const messages = new AgentMessageStore();
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
  const texts: SendSmsInput[] = [];
  const sms = new SmsService();
  sms.send = (input: SendSmsInput) => {
    texts.push(input);
    return Promise.resolve({ ok: true, sid: "SM-784" });
  };
  const commsLog = new LogPaperworkMessage(
    new CommConversationStore(),
    new CommMessageStore(),
  );
  const emailer = new SendPaperworkEmail(
    quotes,
    invoices,
    customers,
    users,
    identity,
    email,
    commsLog,
  );
  const smser = new SendPaperworkSms(
    quotes,
    invoices,
    customers,
    users,
    identity,
    sms,
    new ShortLinkStore(),
    commsLog,
  );
  return {
    conversations,
    messages,
    quotes,
    invoices,
    customers,
    emails,
    texts,
    emailer,
    smser,
    sendQuote: new SendQuote(
      conversations,
      messages,
      quotes,
      new EventBus(),
      emailer,
      smser,
      users,
      undefined,
      customers,
    ),
    billing: new ChatBilling(
      conversations,
      messages,
      quotes,
      invoices,
      customers,
      emailer,
      smser,
      {} as never,
      {} as never,
    ),
    outbox: new OutboxStore(),
  };
}

/** Rosa runs Junk Monsters; Maria reads Spanish and her cell is the
 *  reserved (512) 555-0188 the demo used. */
async function seed(r: ReturnType<typeof rig>) {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const now = new Date().toISOString();
  await (await getKv()).set(["user", USER], {
    id: USER,
    phoneNumber: "+15125559100",
    name: "Rosa Delgado",
    email: "rosa@junkmonsters.test",
    language: "en",
    createdAt: now,
    updatedAt: now,
  });
  await new BusinessIdentityStore().upsert(USER, {
    businessName: "Junk Monsters",
  });
  return await r.customers.create(USER, {
    name: "Maria Lopez",
    email: "maria@example.com",
    phoneNumber: "(512) 555-0188",
    language: "es",
  } as CreateCustomerDto);
}

Deno.test("REQ-784 d12: SendQuote 'email + text' to Maria's 555 cell — the email is listed sent and the skipped text 'not sent' because the number can't receive texts", async () => {
  const r = rig();
  try {
    const maria = await seed(r);
    const quote = await r.quotes.create(USER, {
      customerId: maria.id,
      summary: "Furniture haul-away",
      jobName: "Furniture Haul-Away",
      lineItems: [{
        description: "Haul-away",
        quantity: 1,
        unit: "job",
        price: 320_00,
      }],
      estimatedTotal: 320_00,
      status: "draft",
    });
    const conv = await r.conversations.create({
      userId: USER,
      quoteId: quote.id,
      customerId: maria.id,
    });
    await r.sendQuote.run({
      userId: USER,
      conversationId: conv.id,
      quoteId: quote.id,
      channel: "both",
    });
    assertEquals(r.emails.map((e) => e.to), ["maria@example.com"]);
    assertEquals(r.texts.length, 0, "the 555 cell is never texted");

    const list = await r.outbox.listByUser(USER);
    assertEquals(list.length, 2, JSON.stringify(list, null, 1));
    const mail = list.find((e) => e.channel === "email");
    const text = list.find((e) => e.channel === "text");
    assert(mail && text, JSON.stringify(list, null, 1));
    assertEquals(mail.status, "sent");
    assertEquals(mail.language, "es");
    assertEquals(text.status, "not_sent");
    assertEquals(text.reasonCode, "fictional");
    assertStringIncludes(text.reason ?? "", "555");
    assertEquals(text.kind, "quote");
    assertEquals(text.language, "es");
    assertEquals(text.customerName, "Maria Lopez");
    assertEquals(text.to, "+15125550188");
    assertEquals(text.docRef, (await r.quotes.getOwned(quote.id, USER)).number);
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-784 d12: the chat's invoice send to Maria (email + 555 cell) lists the invoice email sent and the skipped text 'not sent' with why", async () => {
  const r = rig();
  try {
    const maria = await seed(r);
    const inv = await r.invoices.create(USER, {
      customerId: maria.id,
      amount: 320_00,
      dueDate: "2026-12-19",
      status: "draft",
    } as never);
    const conv = await r.conversations.create({
      userId: USER,
      customerId: maria.id,
    });
    await r.billing.send({
      userId: USER,
      conversation: conv,
      lang: "en",
      invoiceId: inv.id,
    });
    assertEquals(r.emails.map((e) => e.to), ["maria@example.com"]);
    assertEquals(r.texts.length, 0);

    const list = await r.outbox.listByUser(USER);
    const text = list.find((e) => e.channel === "text");
    assert(text, JSON.stringify(list, null, 1));
    assertEquals(text.kind, "invoice");
    assertEquals(text.status, "not_sent");
    assertEquals(text.reasonCode, "fictional");
    assertEquals(
      list.find((e) => e.channel === "email")?.status,
      "sent",
    );
  } finally {
    await resetKv();
  }
});
