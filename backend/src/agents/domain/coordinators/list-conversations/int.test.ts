/**
 * REQ-369 (demo-loop cycle 1, demo issue m2) — the conversation list and the
 * chat header name the SAME status at every step, over the real coordinators.
 *
 * The demo saw the header say "Quote accepted" while the list said "Quote
 * sent", "Quote locked · ready to send" while the list said "Drafting",
 * "Not delivered" against "Locked · ready to send", and "Ready to send"
 * while the job description was still being picked. The list chip read the
 * denormalized conv.quoteStatus / currentPhase (never touched by the
 * customer's public accept); the header read the quote row + transcript.
 *
 * One thread walked the demo's way — a drafted quote, Lock, the terms
 * wizard, the end-of-wizard job-details pick, a Send that reaches nobody,
 * then the customer signing on the public page — and after every step the
 * row ListConversations returns carries the status `deriveChatHeader` gives
 * the snapshot the client loads (LoadConversation).
 */
import { assertEquals } from "#std/assert";
import { deriveChatHeader } from "#quote-flow/chat-header.ts";
import { emptyAssistantDraft } from "#quote-flow/assistant-draft.ts";
import { ListConversations } from "./mod.ts";
import { SendQuote } from "@agents/domain/coordinators/send-quote/mod.ts";
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

const USER = "u-369";

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
      users,
    ),
    load: new LoadConversation(conversations, messages, quotes, customers),
    list: new ListConversations(conversations, customers, quotes),
  };
}

async function seedContractor() {
  const kv = await getKv();
  const now = new Date().toISOString();
  await kv.set(["user", USER], {
    id: USER,
    phoneNumber: "+15125550369",
    name: "Test Contractor",
    email: "me@test.dev",
    createdAt: now,
    updatedAt: now,
  });
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

/** What the chat header says for the snapshot the client loads. */
async function headerStatus(s: ReturnType<typeof fresh>, id: string) {
  const snap = await s.load.run({ userId: USER, conversationId: id });
  return deriveChatHeader({
    customerName: snap.customer?.name,
    quote: snap.quote as Parameters<typeof deriveChatHeader>[0]["quote"],
    messages: snap.messages,
    detailsPending: !!snap.draft?.polishRaw?.trim(),
  }).status;
}

/** What the conversation list says for the same thread. */
async function listStatus(s: ReturnType<typeof fresh>, id: string) {
  const rows = await s.list.run({ userId: USER });
  return rows.find((r) => r.id === id)?.threadStatus;
}

/** The header and the list name one status — the expected one. */
async function bothSay(
  s: ReturnType<typeof fresh>,
  id: string,
  want: string,
  step: string,
) {
  const header = await headerStatus(s, id);
  const list = await listStatus(s, id);
  assertEquals(
    { step, header, list },
    { step, header: want, list: want },
    `${step}: the header and the list must both say "${want}"`,
  );
}

async function answerAll(s: ReturnType<typeof fresh>, convId: string) {
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

Deno.test("REQ-369 the list and the header agree at every step: drafted → locked → gathering → picking job details → ready to send → not delivered → signed on the public page", async () => {
  await withKv(async () => {
    const s = fresh();
    // The "I know my price" thread: a quote, no customer, no action_card.
    const quote = await s.quotes.create(USER, {
      summary: "Fence install",
      jobName: "Fence install",
      description: "Fence install, 40 ft cedar",
      lineItems: [{
        description: "Fence",
        quantity: 1,
        unit: "ea",
        price: 480_000,
      }],
      estimatedTotal: 480_000,
      status: "draft",
    });
    const conv = await s.conversations.create({
      userId: USER,
      currentPhase: "quote",
      quoteId: quote.id,
    });

    await bothSay(s, conv.id, "drafted", "a drafted quote");

    await s.lock.run({
      userId: USER,
      conversationId: conv.id,
      quoteId: quote.id,
    });
    await bothSay(s, conv.id, "locked", "after Lock it in");

    await s.toTerms.run({ userId: USER, conversationId: conv.id });
    await bothSay(s, conv.id, "gathering", "the terms wizard asking");

    // The price flow still owes the end-of-wizard job-details pick: the
    // client parked the raw details on the conversation (REQ-230 draft).
    await s.conversations.putDraft(conv.id, {
      ...emptyAssistantDraft(),
      polishRaw: "Fence install, 40 ft cedar",
    });
    await answerAll(s, conv.id);
    await bothSay(
      s,
      conv.id,
      "pickingDetails",
      "the wizard done, the job description still being picked",
    );

    // The pick applied: the client clears the marker.
    await s.conversations.putDraft(conv.id, emptyAssistantDraft());
    await bothSay(s, conv.id, "readyToSend", "the job description picked");

    // Send with nobody to send to.
    await s.send.run({
      userId: USER,
      conversationId: conv.id,
      quoteId: quote.id,
      channel: "email",
    });
    await bothSay(s, conv.id, "undelivered", "a send that reached nobody");

    // The customer signs on the public page (got the link another way):
    // the public controller writes the quote row only — no agents
    // coordinator runs, conv.quoteStatus is never touched.
    await s.quotes.update(quote.id, USER, {
      status: "accepted",
      acceptedAt: new Date().toISOString(),
    });
    await bothSay(s, conv.id, "accepted", "signed on the public page");
    const conversation = await s.conversations.get(conv.id);
    assertEquals(
      conversation.quoteStatus,
      "undelivered",
      "the denormalized conv.quoteStatus is stale — the list must not read it",
    );
  });
});

Deno.test("REQ-369 the list and the header agree after a delivered send, and after the customer declines", async () => {
  await withKv(async () => {
    const s = fresh();
    const customer = await s.customers.create(USER, {
      name: "John Miller",
      email: "john@example.com",
    });
    const quote = await s.quotes.create(USER, {
      summary: "Interior repaint",
      lineItems: [{
        description: "Repaint",
        quantity: 1,
        unit: "ea",
        price: 320_000,
      }],
      estimatedTotal: 320_000,
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
    await answerAll(s, conv.id);
    await bothSay(s, conv.id, "readyToSend", "the wizard done");

    await s.send.run({
      userId: USER,
      conversationId: conv.id,
      quoteId: quote.id,
      channel: "email",
    });
    await bothSay(s, conv.id, "sent", "emailed to the customer");

    await s.quotes.update(quote.id, USER, {
      status: "lost",
      lostAt: new Date().toISOString(),
    });
    await bothSay(s, conv.id, "declined", "the customer declined");
  });
});

Deno.test("REQ-369 every row carries its own status: a chat with no quote yet, a quote in the wizard", async () => {
  await withKv(async () => {
    const s = fresh();
    const chatOnly = await s.conversations.create({
      userId: USER,
      currentPhase: "quote",
    });
    const quote = await s.quotes.create(USER, {
      summary: "Deck stain",
      lineItems: [],
      estimatedTotal: 90_000,
      status: "draft",
    });
    const inWizard = await s.conversations.create({
      userId: USER,
      currentPhase: "quote",
      quoteId: quote.id,
    });
    await s.lock.run({
      userId: USER,
      conversationId: inWizard.id,
      quoteId: quote.id,
    });
    await s.toTerms.run({ userId: USER, conversationId: inWizard.id });

    await bothSay(s, chatOnly.id, "none", "a chat with no quote");
    await bothSay(s, inWizard.id, "gathering", "a quote in the wizard");
  });
});
