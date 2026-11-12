/**
 * REQ-245 (demo issue quote-invoice-money-m6) — the chat header follows the
 * quote, end to end over the real coordinators.
 *
 * Drives one thread the way the demo did — a drafted quote, Lock, the terms
 * wizard to the end, Send — and after every step feeds the snapshot the
 * client loads (`LoadConversation`: messages + quote + customer) through
 * the same `deriveChatHeader` the AsstChat header effect uses.
 */
import { assertEquals } from "#std/assert";
import { deriveChatHeader } from "#quote-flow/chat-header.ts";
import { SendQuote } from "./mod.ts";
import { LockQuote } from "@agents/domain/coordinators/lock-quote/mod.ts";
import { TransitionToTerms } from "@agents/domain/coordinators/transition-to-terms/mod.ts";
import { HandleWizardAnswer } from "@agents/domain/coordinators/handle-wizard-answer/mod.ts";
import { LoadConversation } from "@agents/domain/coordinators/load-conversation/mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { TERMS_WIZARD_V1 } from "@agents/domain/business/terms-wizard-spec/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
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

const H = "asstChat.header.";
const USER = "u-245";

function fresh() {
  const conversations = new AgentConversationStore();
  const messages = new AgentMessageStore();
  const quotes = new QuoteStore();
  const invoices = new InvoiceStore();
  const customers = new CustomerStore();
  const users = new UserStore();
  const identity = new BusinessIdentityStore();
  const bus = new EventBus();
  const email = new EmailService();
  email.send = (_input: SendEmailInput) =>
    Promise.resolve({ ok: true, reason: "test_capture" });
  const log = () =>
    new LogPaperworkMessage(
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
    log(),
  );
  const smser = new SendPaperworkSms(
    quotes,
    invoices,
    customers,
    users,
    identity,
    new SmsService(),
    new ShortLinkStore(),
    log(),
  );
  return {
    conversations,
    quotes,
    customers,
    // REQ-234: LockQuote no longer emits or emails (reconciled on demo-fixes)
    lock: new LockQuote(conversations, messages, quotes, users),
    toTerms: new TransitionToTerms(conversations, messages),
    answer: new HandleWizardAnswer(
      conversations,
      messages,
      quotes,
      customers,
      users,
      bus,
    ),
    send: new SendQuote(
      conversations,
      messages,
      quotes,
      bus,
      emailer,
      smser,
      users, // REQ-276: the note is in the contractor's UI language
    ),
    load: new LoadConversation(conversations, messages, quotes, customers),
  };
}

async function seedContractor() {
  const kv = await getKv();
  const now = new Date().toISOString();
  await kv.set(["user", USER], {
    id: USER,
    phoneNumber: "+15125550000",
    name: "Test Contractor",
    email: "me@test.dev",
    createdAt: now,
    updatedAt: now,
  });
}

async function header(s: ReturnType<typeof fresh>, conversationId: string) {
  const snap = await s.load.run({ userId: USER, conversationId });
  return deriveChatHeader({
    customerName: snap.customer?.name,
    quote: snap.quote as Parameters<typeof deriveChatHeader>[0]["quote"],
    messages: snap.messages,
  });
}

async function finishWizard(s: ReturnType<typeof fresh>, convId: string) {
  for (const step of TERMS_WIZARD_V1.steps) {
    const opt = step.options.find((o) => !o.isCustom)!;
    await s.answer.run({
      userId: USER,
      conversationId: convId,
      stepId: step.id,
      optionId: opt.id,
    });
  }
}

async function withKv(fn: () => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  try {
    await seedContractor();
    await fn();
  } finally {
    await resetKv();
  }
}

Deno.test("REQ-245 chat header over the real flow: drafted → locked → gathering → ready to send → not delivered (no customer)", async () => {
  await withKv(async () => {
    const s = fresh();
    // The "I know my price" thread: a quote, no customer, no action_card.
    const quote = await s.quotes.create(USER, {
      summary: "Fence install",
      jobName: "Fence install",
      lineItems: [{
        description: "Fence",
        quantity: 1,
        unit: "ea",
        price: 4_800,
      }],
      estimatedTotal: 4_800,
      status: "draft",
    });
    const conv = await s.conversations.create({
      userId: USER,
      currentPhase: "quote",
      quoteId: quote.id,
    });

    // (c) a quote exists → its job name, never "New conversation".
    let h = await header(s, conv.id);
    assertEquals(h.clientName, "Fence install");
    assertEquals(h.statusKey, `${H}quoteDrafted`);

    // (b) Lock is not a send.
    await s.lock.run({
      userId: USER,
      conversationId: conv.id,
      quoteId: quote.id,
    });
    h = await header(s, conv.id);
    assertEquals(h.statusKey, `${H}quoteLocked`);

    // The wizard is asking → gathering.
    await s.toTerms.run({ userId: USER, conversationId: conv.id });
    h = await header(s, conv.id);
    assertEquals(h.statusKey, `${H}gatheringInfo`);

    // (a) The wizard finished: the full draft is ready → "Ready to send".
    await finishWizard(s, conv.id);
    h = await header(s, conv.id);
    assertEquals(h.statusKey, `${H}readyToSend`);

    // Send with nobody to send to → "Not delivered", not "Out for signature".
    await s.send.run({
      userId: USER,
      conversationId: conv.id,
      quoteId: quote.id,
      channel: "email",
    });
    h = await header(s, conv.id);
    assertEquals(h.statusKey, `${H}notDelivered`);
    assertEquals(h.clientName, "Fence install");
  });
});

Deno.test("REQ-245 chat header over the real flow: a send that reaches the customer → 'Out for signature' under the customer's name", async () => {
  await withKv(async () => {
    const s = fresh();
    const customer = await s.customers.create(USER, {
      name: "Ana Ruiz",
      email: "ana@example.com",
    });
    const quote = await s.quotes.create(USER, {
      summary: "Roof",
      lineItems: [{
        description: "Roof",
        quantity: 1,
        unit: "ea",
        price: 12_500,
      }],
      estimatedTotal: 12_500,
      status: "draft",
    });
    const conv = await s.conversations.create({
      userId: USER,
      currentPhase: "quote",
      quoteId: quote.id,
      customerId: customer.id,
    });

    await s.lock.run({
      userId: USER,
      conversationId: conv.id,
      quoteId: quote.id,
    });
    await s.toTerms.run({ userId: USER, conversationId: conv.id });
    await finishWizard(s, conv.id);
    let h = await header(s, conv.id);
    assertEquals(h.statusKey, `${H}readyToSend`);
    assertEquals(h.clientName, "Ana Ruiz");

    await s.send.run({
      userId: USER,
      conversationId: conv.id,
      quoteId: quote.id,
      channel: "email",
    });
    h = await header(s, conv.id);
    assertEquals(h.statusKey, `${H}outForSignature`);
    assertEquals(h.clientName, "Ana Ruiz");
  });
});
