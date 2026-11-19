/**
 * REQ-1051 (LOOP-007 cycle 2, q2-35) — AMENDMENT of REQ-337: the job name the
 * customer reads keeps every area the assistant's card named.
 *
 * QA 2 (Spanish) drafted Q-002; the assistant card read "Pintura exterior y
 * reparación de cerca — Jorge Ramirez", but the SMS read "Tu Cotización +
 * Acuerdo para Pintura exterior (Q-002) está lista" — the fence dropped.
 * handle-chat-message threw away the model's over-budget jobName whole
 * (isValidJobName fails at 38 chars), and QuoteStore's fallback cut the
 * summary at 3 words ([Pintura, exterior, y] → "Pintura exterior").
 *
 * The stub LLM replays the create_quote; the coordinator, the stores and the
 * SMS coordinator are real (KV :memory:).
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

async function seedSpanishContractor(userId: string) {
  const kv = await getKv();
  const now = new Date().toISOString();
  await kv.set(["user", userId], {
    id: userId,
    phoneNumber: "+15125550235",
    name: "Ana Torres",
    email: "ana@test.dev",
    language: "es",
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

async function fresh() {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  await seedSpanishContractor("u-1");
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
  return { conversations, llm, quotes, customers, flow, smsFlow, sent };
}

const MESSAGE =
  "cotización para Jorge Ramirez: pintura exterior de la casa $4,200 y reparación de la cerca $1,800";
const SUMMARY = "Pintura exterior y reparación de cerca — Jorge Ramirez";
const LINES = [
  { description: "Pintura exterior de la casa", amountCents: 420_000 },
  { description: "Reparación de la cerca", amountCents: 180_000 },
];

/** Run the chat turn with the model's create_quote, then text the quote to
 *  the customer in Spanish. Returns the stored job name and the SMS body. */
async function draftAndText(jobName: string | undefined) {
  const ctx = await fresh();
  const answer: LLMResponse = {
    text: "Listo, preparé la cotización.",
    action: {
      type: "create_quote",
      payload: { summary: SUMMARY, ...(jobName ? { jobName } : {}), lineItems: LINES },
    },
  };
  ctx.llm.setHandler(() => answer);
  const conv = await ctx.conversations.create({ userId: "u-1" });
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: MESSAGE,
  });
  const card = res.newMessages.find((m) => m.kind === "action_card");
  assert(card, "the turn drew a quote card");
  assertStringIncludes(card.content ?? "", "cerca", "the card names the fence");

  const [quote] = await ctx.quotes.listByUser("u-1");
  assert(quote, "the turn saved a draft quote");
  const customer = await ctx.customers.create("u-1", {
    name: "Jorge Ramirez",
    phoneNumber: "+15125551235",
  });
  await ctx.quotes.update(quote.id, "u-1", { customerId: customer.id });
  const r = await ctx.smsFlow.run("u-1", {
    kind: "quote",
    resourceId: quote.id,
    language: "es",
  });
  assert(r.ok, `the SMS went out: ${r.reason}`);
  const body = ctx.sent[0]?.body ?? "";
  await resetKv();
  return { jobName: quote.jobName ?? "", body };
}

Deno.test("REQ-1051 (LOOP-007 q2-35): the model's over-budget jobName 'Pintura exterior y reparación de cerca' is fitted to the budget, not dropped — the stored name and the SMS keep the fence", async () => {
  const { jobName, body } = await draftAndText(
    "Pintura exterior y reparación de cerca",
  );
  assert(isValidJobName(jobName), `jobName "${jobName}" is outside the budget`);
  assertStringIncludes(
    jobName.toLowerCase(),
    "cerca",
    `the stored jobName "${jobName}" dropped the fence`,
  );
  assertStringIncludes(
    body.toLowerCase(),
    "cerca",
    `the SMS dropped the fence: ${body}`,
  );
});

Deno.test("REQ-1051 (LOOP-007 q2-35): with no model jobName, the derived name for 'Pintura exterior y reparación de cerca — Jorge Ramirez' keeps the fence in the stored name and the SMS", async () => {
  const { jobName, body } = await draftAndText(undefined);
  assert(isValidJobName(jobName), `jobName "${jobName}" is outside the budget`);
  assertStringIncludes(
    jobName.toLowerCase(),
    "cerca",
    `the stored jobName "${jobName}" dropped the fence`,
  );
  assertStringIncludes(
    body.toLowerCase(),
    "cerca",
    `the SMS dropped the fence: ${body}`,
  );
});
