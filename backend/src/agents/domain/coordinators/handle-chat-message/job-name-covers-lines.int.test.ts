/**
 * REQ-1094 (LOOP-007 cycle 3, q3-3) — AMENDMENT of REQ-1051: a job name inside
 * the budget still names every area the quote's lines cover.
 *
 * QA 5 typed "Exterior house paint $3,800 and paint the backyard fence
 * $450.50". The real model answered create_quote with summary "Exterior
 * painting" and jobName "Exterior Painting" (2 words, 17 chars — valid), and
 * the two lines house $3,800.00 + fence $450.50. handle-chat-message keeps a
 * valid model name verbatim (only an over-budget one is refitted), so the
 * stored jobName, the /q heading and the email subjects ("— Pintura
 * exterior", "approved your quote for Exterior Painting", "Firmado: Pintura
 * exterior") all dropped the fence.
 *
 * The stub LLM replays that create_quote; the coordinator, the stores and the
 * email/SMS coordinators are real (KV :memory:).
 */
import { assert, assertStringIncludes } from "#std/assert";
import { HandleChatMessage } from "./mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { StubLLMClient } from "@agents/domain/business/llm/implementations/stub/mod.ts";
import type { LLMResponse } from "@agents/domain/business/llm/base/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { FileStore } from "@files/domain/data/file-store/mod.ts";
import { BusinessAddressStore } from "@profile/domain/data/business-address-store/mod.ts";
import { SendPaperworkEmail } from "@paperwork/domain/coordinators/send-paperwork-email/mod.ts";
import { SendPaperworkSms } from "@paperwork/domain/coordinators/send-paperwork-sms/mod.ts";
import { EmailService } from "@communication/domain/data/email-service/mod.ts";
import { type SendSmsInput, SmsService } from "@users/domain/data/sms/mod.ts";
import { ShortLinkStore } from "@paperwork/domain/data/shortlink-store/mod.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { ConversationStore as CommConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore as CommMessageStore } from "@communication/domain/data/message-store/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";
import { ChangeOrderStore } from "@paperwork/domain/data/change-order-store/mod.ts";
import type { SendChangeOrderAlert } from "@paperwork/domain/coordinators/send-change-order-alert/mod.ts";
import { ApplyChatChangeOrder } from "@agents/domain/coordinators/apply-chat-change-order/mod.ts";
import { ReviseQuote } from "@agents/domain/coordinators/revise-quote/mod.ts";
import { isValidJobName } from "#quote-flow/job-name.ts";

async function seedContractor(userId: string, lang: "en" | "es") {
  const kv = await getKv();
  const now = new Date().toISOString();
  await kv.set(["user", userId], {
    id: userId,
    phoneNumber: "+15125550235",
    name: "Ana Torres",
    email: "ana@test.dev",
    language: lang,
    createdAt: now,
    updatedAt: now,
  });
  await new BusinessIdentityStore().upsert(userId, {
    businessName: "Torres Pintura",
    acceptedPaymentMethods: { check: { enabled: true } },
  });
  await new BusinessAddressStore().upsert(userId, {
    city: "Austin",
    state: "TX",
    postal: "78704",
  });
}

async function fresh(lang: "en" | "es") {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  await seedContractor("u-1", lang);
  const conversations = new AgentConversationStore();
  const messages = new AgentMessageStore();
  const llm = new StubLLMClient();
  const quotes = new QuoteStore();
  const invoices = new InvoiceStore();
  const customers = new CustomerStore();
  const users = new UserStore();
  const identity = new BusinessIdentityStore();
  const email = new EmailService();
  email.send = () => Promise.resolve({ ok: true, reason: "test_capture" });
  const commsLog = () =>
    new LogPaperworkMessage(
      new CommConversationStore(),
      new CommMessageStore(),
    );
  const flow = new HandleChatMessage(
    conversations,
    messages,
    quotes,
    new FileStore(),
    users,
    identity,
    new BusinessAddressStore(),
    new EventBus(),
    new SendPaperworkEmail(
      quotes,
      invoices,
      customers,
      users,
      identity,
      email,
      commsLog(),
    ),
    llm,
    new ApplyChatChangeOrder(
      quotes,
      invoices,
      new ChangeOrderStore(),
      customers,
      {
        run: () => Promise.resolve({ ok: true }),
      } as unknown as SendChangeOrderAlert,
    ),
    new ReviseQuote(quotes, customers),
    undefined,
    customers,
  );
  const sms = new SmsService();
  const sent: SendSmsInput[] = [];
  sms.send = (input: SendSmsInput) => {
    sent.push(input);
    return Promise.resolve({ ok: true, sid: "SM-test" });
  };
  const smsFlow = new SendPaperworkSms(
    quotes,
    invoices,
    customers,
    users,
    identity,
    sms,
    new ShortLinkStore(),
    commsLog(),
  );
  const emailFlow = new SendPaperworkEmail(
    quotes,
    invoices,
    customers,
    users,
    identity,
    email,
    commsLog(),
  );
  return {
    conversations,
    llm,
    quotes,
    customers,
    flow,
    smsFlow,
    emailFlow,
    sent,
  };
}

type Line = { description: string; amountCents: number };

/** Run the chat turn with the model's create_quote, then email and text the
 *  quote to the customer in the contractor's language. */
async function draftAndSend(
  lang: "en" | "es",
  message: string,
  summary: string,
  jobName: string,
  lines: Line[],
) {
  const ctx = await fresh(lang);
  const answer: LLMResponse = {
    text: lang === "es" ? "Listo, preparé la cotización." : "Done — drafted.",
    action: {
      type: "create_quote",
      payload: { summary, jobName, lineItems: lines },
    },
  };
  ctx.llm.setHandler(() => answer);
  const conv = await ctx.conversations.create({ userId: "u-1" });
  await ctx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: message,
  });
  const [quote] = await ctx.quotes.listByUser("u-1");
  assert(quote, "the turn saved a draft quote");
  assert(quote.lineItems.length === 2, "the quote kept both lines");
  const customer = await ctx.customers.create("u-1", {
    name: "María José Peña",
    phoneNumber: "+15125551236",
    email: "maria@test.dev",
  });
  await ctx.quotes.update(quote.id, "u-1", { customerId: customer.id });
  const mail = await ctx.emailFlow.run("u-1", {
    kind: "quote",
    resourceId: quote.id,
    language: lang,
  });
  assert(mail.ok, `the email went out: ${mail.reason}`);
  const sms = await ctx.smsFlow.run("u-1", {
    kind: "quote",
    resourceId: quote.id,
    language: lang,
  });
  assert(sms.ok, `the SMS went out: ${sms.reason}`);
  const body = ctx.sent[0]?.body ?? "";
  await resetKv();
  return { jobName: quote.jobName ?? "", subject: mail.subject, body };
}

Deno.test("REQ-1094 (LOOP-007 q3-3): the model's within-budget jobName 'Exterior Painting' for house + fence lines — the stored name, the email subject and the SMS name the fence", async () => {
  const { jobName, subject, body } = await draftAndSend(
    "en",
    "Quote for María José Peña: Exterior house paint $3,800 and paint the backyard fence $450.50",
    "Exterior painting",
    "Exterior Painting",
    [
      { description: "Exterior house paint", amountCents: 380_000 },
      { description: "Paint the backyard fence", amountCents: 45_050 },
    ],
  );
  assert(isValidJobName(jobName), `jobName "${jobName}" is outside the budget`);
  assertStringIncludes(
    jobName.toLowerCase(),
    "fence",
    `the stored jobName "${jobName}" dropped the fence line`,
  );
  assertStringIncludes(
    subject.toLowerCase(),
    "fence",
    `the quote email subject dropped the fence: ${subject}`,
  );
  assertStringIncludes(
    body.toLowerCase(),
    "fence",
    `the SMS dropped the fence: ${body}`,
  );
});

Deno.test("REQ-1094 (LOOP-007 q3-3): the model's within-budget jobName 'Pintura exterior' for casa + cerca lines — the stored name, the email subject and the SMS name the cerca", async () => {
  const { jobName, subject, body } = await draftAndSend(
    "es",
    "cotización para María José Peña: pintura exterior de la casa $3,800 y pintar la cerca del patio trasero $450.50",
    "Pintura exterior",
    "Pintura exterior",
    [
      { description: "Pintura exterior de la casa", amountCents: 380_000 },
      {
        description: "Pintura de la cerca del patio trasero",
        amountCents: 45_050,
      },
    ],
  );
  assert(isValidJobName(jobName), `jobName "${jobName}" is outside the budget`);
  assertStringIncludes(
    jobName.toLowerCase(),
    "cerca",
    `the stored jobName "${jobName}" dropped the cerca line`,
  );
  assertStringIncludes(
    subject.toLowerCase(),
    "cerca",
    `the quote email subject dropped the cerca: ${subject}`,
  );
  assertStringIncludes(
    body.toLowerCase(),
    "cerca",
    `the SMS dropped the cerca: ${body}`,
  );
});
