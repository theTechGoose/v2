import { assert, assertEquals, assertRejects } from "#std/assert";
import { t } from "@core/i18n/mod.ts";
import { HandleChatMessage } from "./mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { StubLLMClient } from "@agents/domain/business/llm/implementations/stub/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { FileStore } from "@files/domain/data/file-store/mod.ts";
import { BusinessAddressStore } from "@profile/domain/data/business-address-store/mod.ts";
import { SendPaperworkEmail } from "@paperwork/domain/coordinators/send-paperwork-email/mod.ts";
import {
  EmailService,
  type SendEmailInput,
} from "@communication/domain/data/email-service/mod.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { ConversationStore as CommConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore as CommMessageStore } from "@communication/domain/data/message-store/mod.ts";
import { type DomainEvent, EventBus } from "@core/business/events/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";
import { LockQuote } from "@agents/domain/coordinators/lock-quote/mod.ts";
import { reviewJobDetails } from "../../../../../../shared/quote-flow/review-job-details.ts";
import { ChangeOrderStore } from "@paperwork/domain/data/change-order-store/mod.ts";
import type { SendChangeOrderAlert } from "@paperwork/domain/coordinators/send-change-order-alert/mod.ts";
import { ApplyChatChangeOrder } from "@agents/domain/coordinators/apply-chat-change-order/mod.ts";
import { ReviseQuote } from "@agents/domain/coordinators/revise-quote/mod.ts";
import { quoteUpdatedBy } from "../../../../../../front-end/lib/chat-quote-refresh.ts";

/**
 * Seed a fully-onboarded contractor profile for `userId` so the phase-1
 * onboarding gate (name/business/state/address/email/payout) is satisfied
 * and HandleChatMessage routes the turn to the LLM instead of asking for a
 * missing profile field. The quote/lock/email behavior tests below are about
 * paperwork actions, not onboarding — they need a complete profile.
 *
 * UserStore.create() assigns a random id, so the user row (keyed
 * ["user", id]) is written directly; the identity + address stores are
 * stateless KV wrappers, so fresh instances write to the same KV.
 */
async function seedOnboarded(userId: string) {
  const kv = await getKv();
  const now = new Date().toISOString();
  await kv.set(["user", userId], {
    id: userId,
    phoneNumber: "+15125550000",
    name: "Test Contractor",
    email: "me@test.dev",
    createdAt: now,
    updatedAt: now,
  });
  await new BusinessIdentityStore().upsert(userId, {
    businessName: "Test LLC",
    acceptedPaymentMethods: { venmo: { enabled: true, handle: "@test" } },
  });
  await new BusinessAddressStore().upsert(userId, {
    state: "TX",
    postal: "78701",
  });
}

function fresh() {
  const conversations = new AgentConversationStore();
  const messages = new AgentMessageStore();
  const llm = new StubLLMClient();
  const quotes = new QuoteStore();
  const invoices = new InvoiceStore();
  const customers = new CustomerStore();
  const bus = new EventBus();
  const email = new EmailService();
  const sentEmails: SendEmailInput[] = [];
  email.send = (input: SendEmailInput) => {
    sentEmails.push(input);
    return Promise.resolve({ ok: true, reason: "test_capture" });
  };
  const users = new UserStore();
  const identity = new BusinessIdentityStore();
  const emailer = new SendPaperworkEmail(
    quotes,
    invoices,
    customers,
    users,
    identity,
    email,
    new LogPaperworkMessage(
      new CommConversationStore(),
      new CommMessageStore(),
    ),
  );
  const files = new FileStore();
  const addresses = new BusinessAddressStore();
  // REQ-238: the change-order path. The alert is captured, not sent.
  const changeOrders = new ChangeOrderStore();
  const alerted: string[] = [];
  // REQ-456: what the alert reports back (a test may set a delivery), and
  // how long it takes — the reply must wait for it.
  const alertResult: { value: unknown; delayMs: number } = {
    value: { ok: true },
    delayMs: 0,
  };
  const alert = {
    run: (id: string) => {
      alerted.push(id);
      return new Promise((r) =>
        setTimeout(() => r(alertResult.value), alertResult.delayMs)
      );
    },
  } as unknown as SendChangeOrderAlert;
  const changeOrder = new ApplyChatChangeOrder(
    quotes,
    invoices,
    changeOrders,
    customers,
    alert,
  );
  // REQ-315: the reprice-a-line path (revise_quote).
  const reviseQuote = new ReviseQuote(quotes, customers);
  const flow = new HandleChatMessage(
    conversations,
    messages,
    quotes,
    files,
    users,
    identity,
    addresses,
    bus,
    emailer,
    llm,
    changeOrder,
    reviseQuote,
    undefined,
    customers, // REQ-331
  );
  return {
    changeOrders,
    alerted,
    alertResult,
    conversations,
    messages,
    llm,
    quotes,
    invoices,
    customers,
    files,
    users,
    identity,
    addresses,
    bus,
    email,
    emailer,
    sentEmails,
    flow,
  };
}

Deno.test("handle-chat-message integration: appends [user, assistant] messages and updates preview", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, messages, llm, flow } = fresh();
  await seedOnboarded("u-1");
  llm.setScript([{ text: "Got it — what zip code is the job in?" }]);

  const conv = await conversations.create({ userId: "u-1" });
  const result = await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "Garage epoxy floor for the Hernandez family",
  });

  assertEquals(result.newMessages.length, 2);
  assertEquals(result.newMessages[0].role, "user");
  assertEquals(result.newMessages[1].role, "assistant");
  assertEquals(
    result.newMessages[1].content,
    "Got it — what zip code is the job in?",
  );
  assertEquals((await messages.listByConversation(conv.id)).length, 2);
  assertEquals(
    result.conversation.preview,
    "Got it — what zip code is the job in?",
  );
  assertEquals(
    result.conversation.title,
    "Garage epoxy floor for the Hernandez family",
  );
  await resetKv();
});

Deno.test("handle-chat-message integration: cross-user access is forbidden", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, flow } = fresh();
  const conv = await conversations.create({ userId: "u-1" });
  await assertRejects(
    () =>
      flow.run({ userId: "u-2", conversationId: conv.id, content: "intruder" }),
    Error,
    "forbidden",
  );
  await resetKv();
});

Deno.test("handle-chat-message integration: action 'create_quote' creates a real Quote AND emits an action_card", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, quotes, flow } = fresh();
  await seedOnboarded("u-1");
  llm.setScript([{
    text: "Here's your quote.",
    action: {
      type: "create_quote",
      payload: {
        summary: "Quote: 2-Car Garage Epoxy Floor",
        lineItems: [
          { description: "Surface prep + grind", amountCents: 84_000 },
          { description: "Polyaspartic 3-coat", amountCents: 168_000 },
        ],
      },
    },
  }]);

  // Bind a customer at the conversation level (the new contract — the LLM
  // no longer supplies customerId on create_quote).
  const conv = await conversations.create({
    userId: "u-1",
    customerId: "cust-1",
  });
  const result = await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "draft the quote",
  });

  assertEquals(result.newMessages.length, 3);
  const card = result.newMessages[2];
  assertEquals(card.kind, "action_card");
  const cardPayload = card.payload as {
    actionType: string;
    quoteId: string;
    totalCents: number;
  };
  assertEquals(cardPayload.actionType, "quote");
  assertEquals(cardPayload.totalCents, 252_000);
  assert(
    typeof cardPayload.quoteId === "string" && cardPayload.quoteId.length > 0,
  );

  // Quote actually exists in the paperwork store, owned by u-1, status 'draft'.
  const stored = await quotes.getOwned(cardPayload.quoteId, "u-1");
  assertEquals(stored.summary, "Quote: 2-Car Garage Epoxy Floor");
  assertEquals(stored.status, "draft");
  assertEquals(stored.lineItems.length, 2);
  assertEquals(stored.estimatedTotal, 252_000); // INTEGER CENTS — sum of amountCents (audit1 #3)
  assertEquals(stored.lineItems[0].price, 84_000); // CENTS — identity copy from amountCents
  assertEquals(stored.customerId, "cust-1"); // inherited from the conversation

  // Conversation still points at its bound customer + new quote.
  assertEquals(result.conversation.quoteId, cardPayload.quoteId);
  assertEquals(result.conversation.customerId, "cust-1");

  await resetKv();
});

Deno.test("handle-chat-message integration: REQ-234 action 'lock_quote' uses conv.quoteId (NOT the LLM-provided one) and locks it WITHOUT sending", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, quotes, flow } = fresh();
  await seedOnboarded("u-1");
  // Pre-create a real draft quote owned by u-1; bind to conversation.
  const draft = await quotes.create("u-1", {
    summary: "x",
    lineItems: [],
    status: "draft",
  });
  const conv = await conversations.create({ userId: "u-1", quoteId: draft.id });

  llm.setScript([{
    text: "Locked.",
    // LLM hallucinates a different id — coordinator must ignore it and use conv.quoteId.
    action: { type: "lock_quote", payload: { quoteId: "made-up-id" } },
  }]);
  await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "lock it in",
  });
  const reloaded = await quotes.getOwned(draft.id, "u-1");
  // REQ-234 (demo M3): locking is not sending.
  assertEquals(reloaded.status, "draft");
  assertEquals(reloaded.sentAt, undefined);
  assert(reloaded.lockedAt, "lockedAt stamped");
  const convAfter = await conversations.get(conv.id);
  assertEquals(convAfter.quoteStatus, "locked");
  await resetKv();
});

Deno.test("handle-chat-message integration: 'create_quote' emits a 'drafted' DomainEvent on the bus", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, bus, flow } = fresh();
  await seedOnboarded("u-1");
  const seen: DomainEvent[] = [];
  bus.subscribe((e) => {
    seen.push(e);
  });

  llm.setScript([{
    text: "ok",
    action: {
      type: "create_quote",
      payload: {
        summary: "x",
        lineItems: [{ description: "y", amountCents: 100 }],
      },
    },
  }]);
  const conv = await conversations.create({ userId: "u-1" });
  await flow.run({ userId: "u-1", conversationId: conv.id, content: "draft" });

  assertEquals(seen.length, 1);
  assertEquals(seen[0].entityType, "quote");
  assertEquals(seen[0].action, "drafted");
  assertEquals(seen[0].userId, "u-1");
  await resetKv();
});

Deno.test("handle-chat-message integration: REQ-234 'lock_quote' emits NO 'sent' DomainEvent and a 'locked' card", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, quotes, bus, flow } = fresh();
  await seedOnboarded("u-1");
  const seen: DomainEvent[] = [];
  bus.subscribe((e) => {
    if (e.action === "sent") seen.push(e);
  });

  const draft = await quotes.create("u-1", {
    summary: "x",
    lineItems: [],
    status: "draft",
  });
  const conv = await conversations.create({ userId: "u-1", quoteId: draft.id });
  llm.setScript([{
    text: "Locked.",
    action: { type: "lock_quote", payload: { quoteId: draft.id } },
  }]);
  const result = await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "lock",
  });

  assertEquals(seen.length, 0);
  const card = result.newMessages.find((m) => m.kind === "action_card");
  assertEquals((card?.payload as { status?: string })?.status, "locked");
  await resetKv();
});

Deno.test("handle-chat-message integration: action 'request_terms_transition' appends a continue_cta carrying the active quoteId", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, flow } = fresh();
  await seedOnboarded("u-1");
  llm.setScript([{
    text: "Want to wrap the contract terms?",
    action: {
      type: "request_terms_transition",
      payload: { quoteId: "ignored" },
    },
  }]);
  const conv = await conversations.create({ userId: "u-1", quoteId: "q-real" });
  const result = await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "yeah",
  });

  assertEquals(result.newMessages.length, 3);
  const cta = result.newMessages[2];
  assertEquals(cta.kind, "continue_cta");
  const payload = cta.payload as { toPhase: string; quoteId: string };
  assertEquals(payload.toPhase, "terms");
  assertEquals(payload.quoteId, "q-real"); // conv.quoteId wins
  await resetKv();
});

Deno.test("handle-chat-message integration: receives full history (LLM sees previous turns)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, flow } = fresh();
  await seedOnboarded("u-1");
  let observedHistoryLength = 0;
  llm.setHandler((req) => {
    observedHistoryLength = req.messages.length;
    return { text: `seen ${req.messages.length}` };
  });

  const conv = await conversations.create({ userId: "u-1" });
  await flow.run({ userId: "u-1", conversationId: conv.id, content: "first" });
  await flow.run({ userId: "u-1", conversationId: conv.id, content: "second" });
  assertEquals(observedHistoryLength, 3);
  await resetKv();
});

Deno.test("handle-chat-message integration: title locks in on first message and doesn't change", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, flow } = fresh();
  await seedOnboarded("u-1");
  const conv = await conversations.create({ userId: "u-1" });
  const r1 = await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "First message wins title",
  });
  assertEquals(r1.conversation.title, "First message wins title");
  const r2 = await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "Second never overrides",
  });
  assertEquals(r2.conversation.title, "First message wins title");
  await resetKv();
});

Deno.test("handle-chat-message integration: voice kind is preserved on the user message", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, flow } = fresh();
  const conv = await conversations.create({ userId: "u-1" });
  const result = await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "I just talked",
    kind: "voice",
  });
  assertEquals(result.newMessages[0].kind, "voice");
  assert(
    result.newMessages[1].kind === "text",
    "assistant always replies in text",
  );
  await resetKv();
});

Deno.test("handle-chat-message integration: REQ-234 'lock_quote' does NOT email the linked customer (Send does)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, quotes, customers, sentEmails, flow } = fresh();
  await seedOnboarded("u-1");
  const customer = await customers.create("u-1", {
    name: "Acme",
    email: "ops@acme.test",
  });
  const draft = await quotes.create("u-1", {
    summary: "Roof",
    lineItems: [],
    customerId: customer.id,
    status: "draft",
  });
  const conv = await conversations.create({
    userId: "u-1",
    quoteId: draft.id,
    customerId: customer.id,
  });
  llm.setScript([{
    text: "Locked.",
    action: { type: "lock_quote", payload: { quoteId: draft.id } },
  }]);

  await flow.run({ userId: "u-1", conversationId: conv.id, content: "lock" });

  assertEquals(sentEmails.length, 0);
  const after = await quotes.getOwned(draft.id, "u-1");
  assertEquals(after.status, "draft");
  assertEquals(after.sentAt, undefined);
  await resetKv();
});

Deno.test("handle-chat-message integration: 'lock_quote' without a customer email does NOT throw and still locks", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, quotes, sentEmails, flow } = fresh();
  await seedOnboarded("u-1");
  // No customer linked → emailer returns ok=false but does not throw.
  const draft = await quotes.create("u-1", {
    summary: "Orphan",
    lineItems: [],
    status: "draft",
  });
  const conv = await conversations.create({ userId: "u-1", quoteId: draft.id });
  llm.setScript([{
    text: "Locked.",
    action: { type: "lock_quote", payload: { quoteId: draft.id } },
  }]);

  await flow.run({ userId: "u-1", conversationId: conv.id, content: "lock" });

  // Quote still got locked (REQ-234: locked, not sent).
  const lockedQ = await quotes.getOwned(draft.id, "u-1");
  assertEquals(lockedQ.status, "draft");
  assert(lockedQ.lockedAt, "lockedAt stamped");
  // No SMTP call captured.
  assertEquals(sentEmails.length, 0);
  await resetKv();
});

Deno.test("handle-chat-message integration: P1.1 onboarding — asks for name when user has none and short-circuits the LLM", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, users, flow } = fresh();
  llm.setScript([{ text: "should-not-fire" }]); // LLM should be skipped

  await users.create({ phoneNumber: "+15125550100" });
  const me = await users.findByPhone("+15125550100");
  assert(me);
  const conv = await conversations.create({ userId: me!.id });

  const result = await flow.run({
    userId: me!.id,
    conversationId: conv.id,
    content: "Hey",
  });

  assertEquals(result.newMessages.length, 2);
  assertEquals(result.newMessages[1].role, "assistant");
  assert(result.newMessages[1].content.startsWith("Hey there 👋"));
  // The user's name didn't change (we didn't extract anything).
  const fresh1 = await users.get(me!.id);
  assertEquals(fresh1.name, undefined);
  await resetKv();
});

Deno.test("handle-chat-message integration: P1.1 onboarding — extracts name + business and persists", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, users, identity, flow } = fresh();
  llm.setScript([{ text: "should-not-fire" }]);

  await users.create({ phoneNumber: "+15125550100" });
  const me = await users.findByPhone("+15125550100");
  assert(me);
  const conv = await conversations.create({ userId: me!.id });

  // A first-turn message that volunteers "Name, Business" is parsed in one
  // shot (the combined name+business extractor only runs on the first turn).
  const result = await flow.run({
    userId: me!.id,
    conversationId: conv.id,
    content: "Diego, Riley Roofing Co.",
  });

  const after = await users.get(me!.id);
  assertEquals(after.name, "Diego");
  const ident = await identity.get(me!.id);
  assertEquals(ident?.businessName, "Riley Roofing Co.");
  // Name + business done → onboarding advances to the next field (state),
  // not the LLM ("should-not-fire").
  assert(result.newMessages[1].content.startsWith("Almost there"));
  await resetKv();
});

Deno.test("handle-chat-message integration: P1.1 onboarding — does not fire on voice messages", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, users, flow } = fresh();
  llm.setScript([{ text: "Got it — what zip code is the job in?" }]);

  await users.create({ phoneNumber: "+15125550100" });
  const me = await users.findByPhone("+15125550100");
  assert(me);
  const conv = await conversations.create({ userId: me!.id });

  const result = await flow.run({
    userId: me!.id,
    conversationId: conv.id,
    kind: "voice",
    content: "[voice memo transcript]",
  });

  // Voice path goes straight to the LLM, no onboarding ask.
  assertEquals(
    result.newMessages[1].content,
    "Got it — what zip code is the job in?",
  );
  await resetKv();
});

Deno.test("handle-chat-message integration: P1.1 onboarding — quote-shaped first message skips the ask, hits the LLM", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, users, flow } = fresh();
  llm.setScript([{ text: "Got it — what zip code is the job in?" }]);

  await users.create({ phoneNumber: "+15125550100" });
  const me = await users.findByPhone("+15125550100");
  assert(me);
  const conv = await conversations.create({ userId: me!.id });

  // The opening message has a quote signal ($) — shouldn't be parsed as
  // a name reply, but ALSO shouldn't fire the ask (we'd be interrupting
  // a real request). We let the LLM handle it.
  const result = await flow.run({
    userId: me!.id,
    conversationId: conv.id,
    content: "Hey",
  });
  // First message was just "Hey" — the ask fires.
  assert(result.newMessages[1].content.startsWith("Hey there 👋"));

  // Second message — user types a real request instead of a name.
  const result2 = await flow.run({
    userId: me!.id,
    conversationId: conv.id,
    content: "Quote a 2-car garage epoxy floor for the Hernandez family — $480",
  });
  // Should hit the LLM, not the ask. The user's name still isn't set.
  assertEquals(
    result2.newMessages[1].content,
    "Got it — what zip code is the job in?",
  );
  const after = await users.get(me!.id);
  assertEquals(after.name, undefined);
  await resetKv();
});

Deno.test("REQ-008 NW-47 handle-chat-message integration: a first turn that is the starter-chip sentence never becomes the contractor's name/business", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, users, identity, flow } = fresh();
  llm.setScript([{ text: "Got it — tell me about the job." }]);

  await users.create({ phoneNumber: "+15125550100" });
  const me = await users.findByPhone("+15125550100");
  assert(me);
  const conv = await conversations.create({ userId: me!.id });

  // p44 screenshot: "this is I from help me price it" — the flow label had
  // been captured as name "I know the job" + business "help me price it".
  await flow.run({
    userId: me!.id,
    conversationId: conv.id,
    content: "I know the job, help me price it.",
  });

  const after = await users.get(me!.id);
  assertEquals(after.name ?? undefined, undefined);
  const ident = await identity.get(me!.id);
  assertEquals(ident?.businessName ?? undefined, undefined);
  await resetKv();
});

Deno.test("REQ-237 M17 handle-chat-message integration: a chat-drafted quote, locked, gives the review card its line item as job details", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, messages, llm, quotes, users, flow } = fresh();
  await seedOnboarded("u-1");
  llm.setScript([{
    text: "Aquí está tu cotización.",
    action: {
      type: "create_quote",
      payload: {
        summary: "Pintura de baño",
        lineItems: [{ description: "Pintura de baño", amountCents: 45_000 }],
      },
    },
  }]);
  const conv = await conversations.create({ userId: "u-1" });
  const drafted = await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "pintar un baño, $450",
  });
  const quoteId = (drafted.newMessages[2].payload as { quoteId: string })
    .quoteId;

  // "Lock it in" — the card's button hits the lock-quote coordinator.
  // REQ-234: LockQuote no longer emits or emails — it only stamps lockedAt.
  const locked = await new LockQuote(
    conversations,
    messages,
    quotes,
    users,
  ).run({ userId: "u-1", conversationId: conv.id, quoteId });
  const lockCard = locked.newMessages.find((m) => m.kind === "action_card")!;
  const lockPayload = lockCard.payload as {
    description?: string;
    lineItems?: Array<{ description: string; amountCents: number }>;
  };

  // The review card's inputs, exactly as AsstChat assembles them.
  const stored = await quotes.getOwned(quoteId, "u-1");
  const rows = reviewJobDetails({
    previewLang: "es",
    descriptionByLang: stored.descriptionByLang,
    lockedDescription: lockPayload.description,
    description: stored.description,
    lineItems: lockPayload.lineItems,
  });
  assertEquals(rows, [{ text: "Pintura de baño", amountCents: 45_000 }]);
  await resetKv();
});

// ---------------------------------------------------------------------------
// REQ-238 (demo M27): "Change order for Maria: add …" must change Maria's
// existing job — a change order on her invoice, a pending revision on her
// issued quote, a new line on her draft — and never create a new quote.
// ---------------------------------------------------------------------------

const DEMO = "Change order for Maria: add fridge cleaning $40";

/** Maria with a $350 quote in the given state (demo pair 3's setup). */
async function seedMaria(
  f: ReturnType<typeof fresh>,
  status: "draft" | "sent" | "accepted",
) {
  await seedOnboarded("u-1");
  const maria = await f.customers.create("u-1", { name: "Maria Lopez" });
  const quote = await f.quotes.create("u-1", {
    summary: "Deep clean — Maria",
    jobName: "Deep clean",
    customerId: maria.id,
    lineItems: [{
      description: "Deep clean",
      quantity: 1,
      unit: "ea",
      price: 35_000,
    }],
    estimatedTotal: 35_000,
  });
  const live = status === "draft"
    ? quote
    : await f.quotes.update(quote.id, "u-1", {
      status,
      sentAt: new Date().toISOString(),
      ...(status === "accepted"
        ? { acceptedAt: new Date().toISOString() }
        : {}),
    });
  return { maria, quote: live };
}

/** The demo's mistake, as the real model made it: a fresh $40 create_quote. */
const NEW_QUOTE_MISTAKE = {
  text: "Drafting a quote.",
  action: {
    type: "create_quote" as const,
    payload: {
      summary: "Fridge cleaning — Maria",
      lineItems: [{ description: "Fridge cleaning", amountCents: 4_000 }],
    },
  },
};

async function onlyQuoteIs(f: ReturnType<typeof fresh>, id: string) {
  const all = await f.quotes.listByUser("u-1");
  assertEquals(all.map((q) => q.id), [id], "no new quote was created");
}

Deno.test("REQ-238 M27: the demo's sentence on Maria's sent, unsigned quote writes a pending revision (+$40) — no new $40 quote", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = fresh();
  const { quote } = await seedMaria(f, "sent");
  // the model would have drafted a new quote; it must not matter
  f.llm.setScript([NEW_QUOTE_MISTAKE]);
  // a NEW conversation — nothing bound, as in the demo
  const conv = await f.conversations.create({ userId: "u-1" });
  const result = await f.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: DEMO,
  });

  await onlyQuoteIs(f, quote.id);
  const stored = await f.quotes.getOwned(quote.id, "u-1");
  // the live (published) version the customer sees is untouched…
  assertEquals(stored.lineItems.length, 1);
  assertEquals(stored.estimatedTotal, 35_000);
  // …and the change waits as the next revision (REQ-201)
  const pending = stored.pendingRevision as {
    lineItems: { description: string; price: number }[];
    estimatedTotal: number;
  };
  assertEquals(pending.lineItems.map((l) => [l.description, l.price]), [[
    "Deep clean",
    35_000,
  ], ["Fridge cleaning", 4_000]]);
  assertEquals(pending.estimatedTotal, 39_000);
  // no quote card, and the reply says what happened and what to do next
  assertEquals(result.newMessages.some((m) => m.kind === "action_card"), false);
  const reply = result.newMessages[result.newMessages.length - 1];
  assertEquals(reply.role, "assistant");
  assert(reply.content.includes("Fridge cleaning"), reply.content);
  assert(reply.content.includes("$40.00"), reply.content);
  assert(reply.content.includes("Publish revision"), reply.content);
  // REQ-315 (m49): the payload also names the quote, for the chat's link.
  assertEquals(
    (reply.payload as {
      changeOrder?: { kind: string; quoteId: string; quoteNumber?: string };
    })?.changeOrder,
    {
      kind: "pending_revision",
      quoteId: quote.id,
      quoteNumber: stored.number,
    },
  );
  await resetKv();
});

Deno.test("REQ-238 M27: Maria's signed quote with an invoice gets a pending change order on that invoice (+$40)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = fresh();
  const { maria, quote } = await seedMaria(f, "accepted");
  const inv = await f.invoices.create("u-1", {
    quoteId: quote.id,
    customerId: maria.id,
    amount: 35_000,
    status: "sent",
  } as never);
  f.llm.setScript([NEW_QUOTE_MISTAKE]);
  const conv = await f.conversations.create({ userId: "u-1" });
  const result = await f.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: DEMO,
  });

  await onlyQuoteIs(f, quote.id);
  const cos = await f.changeOrders.listByInvoice("u-1", inv.id);
  assertEquals(cos.length, 1);
  assertEquals(cos[0].status, "pending");
  assertEquals(cos[0].description, "Fridge cleaning");
  assertEquals(cos[0].deltaAmountCents, 4_000);
  assertEquals(cos[0].quoteId, quote.id);
  assertEquals(cos[0].customerId, maria.id);
  assertEquals(cos[0].originalAmountCents, 35_000);
  // the invoice only moves when Maria approves at /co/:id
  assertEquals((await f.invoices.getOwned(inv.id, "u-1")).amount, 35_000);
  assertEquals(
    f.alerted,
    [cos[0].id],
    "the contractor is sent the approval link",
  );
  const reply = result.newMessages[result.newMessages.length - 1];
  assert(reply.content.includes("approv"), reply.content);
  assertEquals(
    (reply.payload as { changeOrder?: Record<string, string> })?.changeOrder,
    {
      kind: "change_order",
      quoteId: quote.id,
      // REQ-315 (m49): the outcome names the quote's number for the chat link.
      quoteNumber: "Q-001",
      invoiceId: inv.id,
      changeOrderId: cos[0].id,
      // REQ-456 (M25): and the change order's own number and approval link
      changeOrderNumber: cos[0].number ?? "",
      approvalPath: `/co/${cos[0].id}`,
    },
  );
  await resetKv();
});

Deno.test("REQ-456 M25: a chat change order waits for the alert and says what reached the customer — 'Sent CO-001 to Maria Lopez by email (…) — text failed (…)' — with the CO number and /co link on the outcome", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = fresh();
  const { maria, quote } = await seedMaria(f, "accepted");
  const inv = await f.invoices.create("u-1", {
    quoteId: quote.id,
    customerId: maria.id,
    amount: 35_000,
    status: "sent",
  } as never);
  f.alertResult.delayMs = 30;
  f.alertResult.value = {
    ok: true,
    customer: {
      number: "CO-001",
      approvalPath: "/co/PLACEHOLDER?lang=en",
      emailedTo: "maria@example.com",
      smsFailureReason: "invalid number",
    },
  };
  f.llm.setScript([NEW_QUOTE_MISTAKE]);
  const conv = await f.conversations.create({ userId: "u-1" });
  const result = await f.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: `${DEMO}. Send it to her.`,
  });
  const cos = await f.changeOrders.listByInvoice("u-1", inv.id);
  assertEquals(cos.length, 1);
  const reply = result.newMessages[result.newMessages.length - 1];
  assert(
    reply.content.includes(
      "Sent CO-001 to Maria Lopez by email (maria@example.com) — text failed (invalid number).",
    ),
    reply.content,
  );
  assert(!reply.content.includes("sent you the link"), reply.content);
  const outcome = (reply.payload as { changeOrder?: Record<string, unknown> })
    ?.changeOrder;
  assertEquals(outcome?.changeOrderNumber, "CO-001");
  assertEquals(outcome?.approvalPath, "/co/PLACEHOLDER?lang=en");
  assertEquals(outcome?.delivery, {
    emailedTo: "maria@example.com",
    smsFailureReason: "invalid number",
  });
  await resetKv();
});

Deno.test("REQ-456 M25: when the alert throws, the reply says the change order was not sent and points at the approval link", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = fresh();
  const { maria, quote } = await seedMaria(f, "accepted");
  await f.invoices.create("u-1", {
    quoteId: quote.id,
    customerId: maria.id,
    amount: 35_000,
    status: "sent",
  } as never);
  (f.alertResult as { value: unknown }).value = Promise.reject(
    new Error("postmark down"),
  );
  // keep the rejected promise from being reported as unhandled before use
  ((f.alertResult.value as Promise<unknown>).catch(() => {}));
  f.llm.setScript([NEW_QUOTE_MISTAKE]);
  const conv = await f.conversations.create({ userId: "u-1" });
  const result = await f.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: DEMO,
  });
  const reply = result.newMessages[result.newMessages.length - 1];
  assert(reply.content.includes("not sent"), reply.content);
  assert(reply.content.includes("postmark down"), reply.content);
  assert(reply.content.includes("approval link"), reply.content);
  await resetKv();
});

Deno.test("REQ-238 M27: when the model fires create_quote on a change-order request the parser can't complete, it is turned into the change order", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = fresh();
  const { quote } = await seedMaria(f, "sent");
  f.llm.setScript([NEW_QUOTE_MISTAKE]);
  const conv = await f.conversations.create({ userId: "u-1" });
  await f.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content:
      "Change order for Maria, she wants the fridge cleaned too, forty bucks",
  });
  await onlyQuoteIs(f, quote.id);
  const pending = (await f.quotes.getOwned(quote.id, "u-1"))
    .pendingRevision as {
      lineItems: {
        description: string;
        quantity: number;
        unit: string;
        price: number;
      }[];
    };
  assertEquals(pending.lineItems[1], {
    description: "Fridge cleaning",
    quantity: 1,
    unit: "ea",
    price: 4_000,
  });
  await resetKv();
});

Deno.test("REQ-238 M27: the model's own change_order tool call is executed against the customer's quote", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = fresh();
  const { quote } = await seedMaria(f, "sent");
  f.llm.setScript([{
    text: "",
    action: {
      type: "change_order",
      payload: {
        customerName: "Maria",
        description: "Oven cleaning",
        deltaAmountCents: 6_000,
      },
    },
  }]);
  const conv = await f.conversations.create({ userId: "u-1" });
  const result = await f.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "Maria also wants the oven done, add 60 to her job",
  });
  await onlyQuoteIs(f, quote.id);
  const pending = (await f.quotes.getOwned(quote.id, "u-1"))
    .pendingRevision as { estimatedTotal: number };
  assertEquals(pending.estimatedTotal, 41_000);
  assert(result.newMessages.at(-1)!.content.includes("Oven cleaning"));
  await resetKv();
});

Deno.test("REQ-238 M27: two customers called Maria → a clarifying question; nothing is written", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = fresh();
  const { quote } = await seedMaria(f, "sent");
  const other = await f.customers.create("u-1", { name: "Maria Gomez" });
  const q2 = await f.quotes.create("u-1", {
    summary: "Window wash — Maria G",
    jobName: "Window wash",
    customerId: other.id,
    lineItems: [{
      description: "Windows",
      quantity: 1,
      unit: "ea",
      price: 20_000,
    }],
    estimatedTotal: 20_000,
    status: "sent",
  });
  f.llm.setScript([NEW_QUOTE_MISTAKE]);
  const conv = await f.conversations.create({ userId: "u-1" });
  const result = await f.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: DEMO,
  });

  assertEquals((await f.quotes.listByUser("u-1")).length, 2, "no new quote");
  assertEquals(
    (await f.quotes.getOwned(quote.id, "u-1")).pendingRevision,
    undefined,
  );
  assertEquals(
    (await f.quotes.getOwned(q2.id, "u-1")).pendingRevision,
    undefined,
  );
  const reply = result.newMessages.at(-1)!;
  assert(reply.content.includes("Which"), reply.content);
  assert(
    reply.content.includes("Maria Lopez") &&
      reply.content.includes("Maria Gomez"),
    reply.content,
  );
  await resetKv();
});

Deno.test("REQ-238 M27: no quote for the named customer → says so; no new quote", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = fresh();
  await seedOnboarded("u-1");
  f.llm.setScript([NEW_QUOTE_MISTAKE]);
  const conv = await f.conversations.create({ userId: "u-1" });
  const result = await f.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: DEMO,
  });
  assertEquals((await f.quotes.listByUser("u-1")).length, 0, "no new quote");
  assert(result.newMessages.at(-1)!.content.includes("Maria"));
  await resetKv();
});

Deno.test("REQ-238 M27: a signed quote with no invoice is left alone and the reply says to invoice it first; no new quote", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = fresh();
  const { quote } = await seedMaria(f, "accepted");
  f.llm.setScript([NEW_QUOTE_MISTAKE]);
  const conv = await f.conversations.create({ userId: "u-1" });
  const result = await f.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: DEMO,
  });
  await onlyQuoteIs(f, quote.id);
  const stored = await f.quotes.getOwned(quote.id, "u-1");
  assertEquals(stored.pendingRevision, undefined);
  assertEquals(stored.estimatedTotal, 35_000);
  assert(result.newMessages.at(-1)!.content.toLowerCase().includes("invoice"));
  await resetKv();
});

Deno.test("REQ-238 M27: a change order on the conversation's own draft adds the line to that draft", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = fresh();
  const { quote } = await seedMaria(f, "draft");
  const conv = await f.conversations.create({ userId: "u-1" });
  await f.conversations.update(conv.id, { quoteId: quote.id });
  await f.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "change order: add fridge cleaning $40",
  });
  await onlyQuoteIs(f, quote.id);
  const stored = await f.quotes.getOwned(quote.id, "u-1");
  assertEquals(stored.lineItems.map((l) => l.description), [
    "Deep clean",
    "Fridge cleaning",
  ]);
  assertEquals(stored.estimatedTotal, 39_000);
  await resetKv();
});

// ---------------------------------------------------------------------------
// REQ-455 (demo-loop cycle 3, M24): pair 5's narrative sentence skipped the
// model and the client's /co page showed the raw request, garbled. A sentence
// like that goes to the model's change_order tool, whose clean description is
// what the change order stores; the typed $1,200 still checks its delta.
// ---------------------------------------------------------------------------

Deno.test("REQ-455 M24: the demo's narrative change-order sentence stores the model's clean description, not the garbled raw request", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = fresh();
  await seedOnboarded("u-1");
  const karen = await f.customers.create("u-1", { name: "Karen Holt" });
  const created = await f.quotes.create("u-1", {
    summary: "Bathroom remodel — Karen",
    jobName: "Bathroom remodel",
    customerId: karen.id,
    lineItems: [{
      description: "Bathroom remodel",
      quantity: 1,
      unit: "ea",
      price: 1_400_000,
    }],
    estimatedTotal: 1_400_000,
  });
  const quote = await f.quotes.update(created.id, "u-1", {
    status: "accepted",
    sentAt: new Date().toISOString(),
    acceptedAt: new Date().toISOString(),
  });
  const inv = await f.invoices.create("u-1", {
    quoteId: quote.id,
    customerId: karen.id,
    amount: 1_400_000,
    status: "sent",
  } as never);
  let llmCalls = 0;
  f.llm.setHandler(() => {
    llmCalls++;
    return {
      text: "",
      action: {
        type: "change_order",
        payload: {
          quoteNumber: "Q-001",
          description: "Upgrade to a frameless glass shower door",
          deltaAmountCents: 120_000,
        },
      },
    };
  });
  const conv = await f.conversations.create({ userId: "u-1" });
  await f.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content:
      "Karen signed but now she wants to upgrade to a frameless glass shower door, add $1,200. Make a change order for Q-001 and send it to her.",
  });
  assertEquals(llmCalls, 1, "the model reads a narrative change order");
  const cos = await f.changeOrders.listByInvoice("u-1", inv.id);
  assertEquals(cos.length, 1);
  assertEquals(
    cos[0].description,
    "Upgrade to a frameless glass shower door",
  );
  assertEquals(cos[0].deltaAmountCents, 120_000);
  await resetKv();
});

// ---------------------------------------------------------------------------
// REQ-263 (demo ai-assistant-m2): "412 Oak St Austin" typed in the chat must
// land on the quote as its service (job) address.
// ---------------------------------------------------------------------------

Deno.test("REQ-263 handle-chat-message integration: create_quote's serviceAddress is stored on the quote", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, quotes, flow } = fresh();
  await seedOnboarded("u-1");
  llm.setScript([{
    text: "Here's your quote.",
    action: {
      type: "create_quote",
      payload: {
        summary: "Quote: Deep clean — Maria Lopez",
        serviceAddress: "412 Oak St, Austin TX",
        lineItems: [{ description: "Deep clean", amountCents: 35_000 }],
      },
    },
  }]);
  const conv = await conversations.create({ userId: "u-1" });
  const result = await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    // REQ-418: the model's address must be grounded in what the user typed
    // (here in a form the deterministic extractor cannot read: lower case).
    content: "Deep clean for Maria Lopez at 412 oak st in austin, $350",
  });
  const stored = await quotes.getOwned(result.conversation.quoteId!, "u-1");
  assertEquals(stored.serviceAddress, "412 Oak St, Austin TX");
  await resetKv();
});

Deno.test("REQ-263 handle-chat-message integration: when the model leaves serviceAddress off, the address typed in the chat is still kept (the demo's exact sentence)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, quotes, flow } = fresh();
  await seedOnboarded("u-1");
  llm.setScript([{
    text: "Here's your quote.",
    action: {
      type: "create_quote",
      payload: {
        summary: "Quote: Deep clean — Maria Lopez",
        lineItems: [{ description: "Deep clean", amountCents: 35_000 }],
      },
    },
  }]);
  const conv = await conversations.create({ userId: "u-1" });
  const result = await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "Deep clean for Maria Lopez, 412 Oak St Austin, $350",
  });
  const stored = await quotes.getOwned(result.conversation.quoteId!, "u-1");
  assertEquals(stored.serviceAddress, "412 Oak St Austin");
  await resetKv();
});

Deno.test("REQ-263 handle-chat-message integration: a later correction without an address keeps the one already on the draft", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, quotes, flow } = fresh();
  await seedOnboarded("u-1");
  const action = (amountCents: number) => ({
    type: "create_quote" as const,
    payload: {
      summary: "Quote: Deep clean — Maria Lopez",
      lineItems: [{ description: "Deep clean", amountCents }],
    },
  });
  llm.setScript([
    { text: "Here's your quote.", action: action(35_000) },
    { text: "Updated.", action: action(40_000) },
  ]);
  const conv = await conversations.create({ userId: "u-1" });
  const first = await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "Deep clean for Maria Lopez, 412 Oak St Austin, $350",
  });
  await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "make it $400",
  });
  const stored = await quotes.getOwned(first.conversation.quoteId!, "u-1");
  assertEquals(stored.estimatedTotal, 40_000);
  assertEquals(stored.serviceAddress, "412 Oak St Austin");
  await resetKv();
});

// REQ-267 (demo issue ai-assistant-p1-noreply): a correction re-drafts the
// quote via create_quote, the model often returns no prose, and the turn
// used to land as an updated card with no text at all. A revision of an
// existing draft now always gets a server-written reply naming the change —
// and a deposit ask (create_quote has no deposit field) is acknowledged.
async function draftThenCorrect(correctionText: string, content: string) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  await seedOnboarded("u-1");
  ctx.llm.setScript([
    {
      text: "",
      action: {
        type: "create_quote",
        payload: {
          summary: "Interior repaint",
          lineItems: [
            { description: "Interior walls — 2 coats", amountCents: 180_000 },
            { description: "Paint (materials)", amountCents: 30_000 },
          ],
        },
      },
    },
    {
      text: correctionText,
      action: {
        type: "create_quote",
        payload: {
          summary: "Interior repaint",
          lineItems: [
            { description: "Interior walls — 2 coats", amountCents: 180_000 },
            {
              description: "Paint supplied by Castro Painting",
              amountCents: 0,
            },
          ],
        },
      },
    },
  ]);
  const conv = await ctx.conversations.create({ userId: "u-1" });
  const first = await ctx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "Interior repaint, 3 bedrooms, $2,100",
  });
  const second = await ctx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content,
  });
  return { ...ctx, first, second };
}

Deno.test("REQ-267 handle-chat-message integration: a correction that re-drafts with no prose still gets a text reply naming the change", async () => {
  const { first, second, quotes } = await draftThenCorrect(
    "",
    "I'll supply the paint myself and I want a 50% deposit",
  );
  // First draft: card only (the #36 suppression stays for a fresh draft).
  assertEquals(first.newMessages.map((m) => m.kind), ["text", "action_card"]);
  assertEquals(first.newMessages[0].role, "user");

  const kinds = second.newMessages.map((m) => `${m.role}:${m.kind}`);
  assertEquals(kinds, ["user:text", "assistant:text", "assistant:action_card"]);
  const reply = second.newMessages[1].content;
  assert(reply.includes("Updated the quote"), reply);
  // REQ-666 (m48): the one typed $2,100 drafted as two lines is kept as ONE
  // line naming both, so that is the line the correction replaces.
  assert(
    reply.includes("removed Interior walls — 2 coats (incl. paint (materials))"),
    reply,
  );
  assert(reply.includes("added Paint supplied by Castro Painting"), reply);
  assert(reply.includes("Total $2,100 → $1,800"), reply);
  assert(reply.toLowerCase().includes("deposit"), reply);

  // Same quote updated in place.
  const card1 = first.newMessages[1].payload as { quoteId: string };
  const card2 = second.newMessages[2].payload as { quoteId: string };
  assertEquals(card2.quoteId, card1.quoteId);
  const stored = await quotes.getOwned(card2.quoteId, "u-1");
  assertEquals(stored.estimatedTotal, 180_000);
  await resetKv();
});

Deno.test("REQ-267 handle-chat-message integration: a correction whose prose was only a customer ask still gets a text reply", async () => {
  const { second } = await draftThenCorrect(
    "Who's this for?",
    "supply the paint myself",
  );
  const kinds = second.newMessages.map((m) => `${m.role}:${m.kind}`);
  assertEquals(kinds, ["user:text", "assistant:text", "assistant:action_card"]);
  const reply = second.newMessages[1].content;
  assert(reply.includes("Updated the quote"), reply);
  assert(!reply.toLowerCase().includes("deposit"), reply);
  await resetKv();
});

Deno.test("REQ-267 ai-assistant-p1-noreply: a correction that re-drafts the quote with no LLM prose still gets a text reply saying what changed (incl. the deposit)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, quotes, flow } = fresh();
  await seedOnboarded("u-1");
  const draft = await quotes.create("u-1", {
    summary: "Interior repaint",
    lineItems: [
      {
        description: "Interior walls — 2 coats",
        quantity: 1,
        unit: "ea",
        price: 180_000,
      },
      {
        description: "Paint (materials)",
        quantity: 1,
        unit: "ea",
        price: 30_000,
      },
    ],
    estimatedTotal: 210_000,
    status: "draft",
  });
  const conv = await conversations.create({ userId: "u-1", quoteId: draft.id });
  // The model re-issues create_quote and says nothing (fallbackTextFor → "").
  llm.setScript([{
    text: "",
    action: {
      type: "create_quote",
      payload: {
        summary: "Interior repaint",
        lineItems: [
          { description: "Interior walls — 2 coats", amountCents: 180_000 },
          { description: "Paint supplied by Castro Painting", amountCents: 0 },
        ],
      },
    },
  }]);
  const result = await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content:
      "Castro Painting will supply the paint myself, and I want a 50% deposit",
  });
  const texts = result.newMessages.filter((m) =>
    m.role === "assistant" && m.kind === "text"
  );
  assertEquals(
    texts.length,
    1,
    "a correction must not be answered by a bare card",
  );
  const reply = texts[0].content;
  assert(reply.includes("removed Paint (materials)"), reply);
  assert(reply.includes("added Paint supplied by Castro Painting"), reply);
  assert(reply.toLowerCase().includes("deposit"), reply);
  // Card still lands, updated in place on the same draft.
  const card = result.newMessages.find((m) => m.kind === "action_card")!;
  assertEquals((card.payload as { quoteId: string }).quoteId, draft.id);
  await resetKv();
});

Deno.test("REQ-267 ai-assistant-p1-noreply: the FIRST draft keeps the #36 suppression (card only, no filler bubble)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, flow } = fresh();
  await seedOnboarded("u-1");
  const conv = await conversations.create({ userId: "u-1" });
  llm.setScript([{
    text: "",
    action: {
      type: "create_quote",
      payload: {
        summary: "Interior repaint",
        lineItems: [{ description: "Walls", amountCents: 100_000 }],
      },
    },
  }]);
  const result = await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "quote interior repaint 1200 sqft",
  });
  assertEquals(
    result.newMessages.filter((m) =>
      m.kind === "text" && m.role === "assistant"
    ).length,
    0,
  );
  await resetKv();
});

// ---- REQ-258 (demo M22): "half deposit" reaches the terms wizard ----------
Deno.test("REQ-258 handle-chat-message integration: create_quote with paymentTerms stores it on the conversation's terms prefill; a correction without it keeps it", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, flow } = fresh();
  await seedOnboarded("u-1");
  llm.setScript([
    {
      text: "Drafting a quote.",
      action: {
        type: "create_quote",
        payload: {
          summary: "Interior painting",
          lineItems: [{
            description:
              "Interior painting (3 bedrooms, walls and ceilings, 2 coats, paint supplied by contractor)",
            amountCents: 240_000,
          }],
          paymentTerms: "50_50",
        },
      },
    },
    {
      text: "Drafting a quote.",
      action: {
        type: "create_quote",
        payload: {
          summary: "Interior painting",
          lineItems: [{
            description: "Interior painting",
            amountCents: 250_000,
          }],
        },
      },
    },
  ]);

  const conv = await conversations.create({ userId: "u-1" });
  const first = await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content:
      "Interior paint, 3 bedrooms, walls and ceilings, 2 coats, I supply paint. $2,400 total, half deposit.",
  });
  assertEquals(first.conversation.termsPrefill, { payment_terms: "50_50" });
  assertEquals((await conversations.get(conv.id)).termsPrefill, {
    payment_terms: "50_50",
  });

  const second = await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "make it $2,500",
  });
  assertEquals(second.conversation.termsPrefill, { payment_terms: "50_50" });
  await resetKv();
});

Deno.test("REQ-258 handle-chat-message integration: create_quote without paymentTerms sets no prefill", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, flow } = fresh();
  await seedOnboarded("u-1");
  llm.setScript([{
    text: "Drafting a quote.",
    action: {
      type: "create_quote",
      payload: {
        summary: "Gutter cleaning",
        lineItems: [{ description: "Gutter cleaning", amountCents: 22_000 }],
      },
    },
  }]);
  const conv = await conversations.create({ userId: "u-1" });
  const r = await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "gutter cleaning $220",
  });
  assertEquals(r.conversation.termsPrefill, undefined);
  await resetKv();
});

// ---------------------------------------------------------------------------
// REQ-262 (demo M25): "AI ignored 'Spanish AND English', refused to change job
// details, then replied in raw markdown". The quote was made by the wizard
// (POST /quotes, no action_card) and the conversation moved to 'terms'; free
// text then reached the LLM with a prompt that forbade job-details changes,
// no tool to make them, no sight of the saved quote, and no plain-text rule.
// ---------------------------------------------------------------------------

async function wizardQuoteInTerms(
  fx: ReturnType<typeof fresh>,
  status = "sent",
) {
  await seedOnboarded("u-1");
  const quote = await fx.quotes.create("u-1", {
    summary: "Kitchen repaint",
    jobName: "Kitchen repaint",
    description: "Repaint kitchen walls\nTwo coats, semi-gloss",
    lineItems: [{
      description: "Kitchen repaint",
      quantity: 1,
      unit: "ea",
      price: 180_000,
    }],
    estimatedTotal: 180_000,
    status,
  });
  const conv = await fx.conversations.create({
    userId: "u-1",
    quoteId: quote.id,
    currentPhase: "terms",
  });
  return { quote, conv };
}

Deno.test("REQ-262 handle-chat-message integration: terms phase — the model sees the saved quote (wizard-made, no action_card)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const fx = fresh();
  const { conv } = await wizardQuoteInTerms(fx);
  let seen: { systemPrompt: string; businessContext?: string } | undefined;
  fx.llm.setHandler((req) => {
    seen = req;
    return { text: "ok" };
  });
  await fx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "what's on the quote?",
  });
  assert(seen, "LLM was not called");
  const ctx = seen!.businessContext ?? "";
  assert(ctx.includes("Kitchen repaint"), `businessContext: ${ctx}`);
  assert(ctx.includes("Repaint kitchen walls"), `businessContext: ${ctx}`);
  assert(ctx.includes("$1,800.00"), `businessContext: ${ctx}`);
  await resetKv();
});

Deno.test("REQ-262 handle-chat-message integration: terms prompt no longer forbids job-details changes and demands plain text", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const fx = fresh();
  const { conv } = await wizardQuoteInTerms(fx);
  let prompt = "";
  fx.llm.setHandler((req) => {
    prompt = req.systemPrompt;
    return { text: "ok" };
  });
  await fx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "make the job details Spanish AND English",
  });
  assert(!prompt.includes("job-details changes — phase 1 is locked"), prompt);
  assert(prompt.includes("update_job_details"), prompt);
  assert(/plain text/i.test(prompt) && /markdown/i.test(prompt), prompt);
  await resetKv();
});

Deno.test("REQ-262 handle-chat-message integration: update_job_details writes description + descriptionByLang on the bound quote and flags the reply", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const fx = fresh();
  const { quote, conv } = await wizardQuoteInTerms(fx);
  fx.llm.setScript([{
    text: "",
    action: {
      type: "update_job_details",
      payload: {
        descriptionByLang: {
          en: "Repaint kitchen walls\nTwo coats, semi-gloss",
          es: "Repintar las paredes de la cocina\nDos capas, semibrillo",
        },
      },
    },
  }]);
  const res = await fx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "make the job details Spanish AND English",
  });
  const stored = await fx.quotes.getOwned(quote.id, "u-1");
  assertEquals(stored.descriptionByLang, {
    en: "Repaint kitchen walls\nTwo coats, semi-gloss",
    es: "Repintar las paredes de la cocina\nDos capas, semibrillo",
  });
  assertEquals(
    stored.description,
    "Repaint kitchen walls\nTwo coats, semi-gloss",
  );
  // Prices untouched.
  assertEquals(stored.estimatedTotal, 180_000);
  const reply = res.newMessages.find((m) =>
    m.role === "assistant" && m.kind === "text"
  );
  assert(reply, "no assistant reply");
  assert(reply!.content.trim().length > 0, "empty reply bubble");
  assertEquals(
    (reply!.payload as { quoteUpdated?: string } | undefined)?.quoteUpdated,
    quote.id,
  );
  await resetKv();
});

Deno.test("REQ-262 handle-chat-message integration: update_job_details never touches a signed (accepted) quote", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const fx = fresh();
  const { quote, conv } = await wizardQuoteInTerms(fx, "accepted");
  fx.llm.setScript([{
    text: "Done.",
    action: {
      type: "update_job_details",
      payload: { descriptionByLang: { es: "Repintar" } },
    },
  }]);
  const res = await fx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "add Spanish",
  });
  const stored = await fx.quotes.getOwned(quote.id, "u-1");
  assertEquals(stored.descriptionByLang, undefined);
  const reply = res.newMessages.find((m) =>
    m.role === "assistant" && m.kind === "text"
  );
  assert(
    reply && reply.content !== "Done.",
    "claimed success on a signed quote",
  );
  assertEquals(
    (reply!.payload as { quoteUpdated?: string } | undefined)?.quoteUpdated,
    undefined,
  );
  await resetKv();
});

Deno.test("REQ-262 handle-chat-message integration: a markdown reply is stored as plain text", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const fx = fresh();
  const { conv } = await wizardQuoteInTerms(fx);
  fx.llm.setScript([{
    text:
      "- **English:** Repaint kitchen walls\n- **Spanish:** Repintar paredes",
  }]);
  const res = await fx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "show me both",
  });
  const reply = res.newMessages.find((m) =>
    m.role === "assistant" && m.kind === "text"
  );
  assertEquals(
    reply?.content,
    "• English: Repaint kitchen walls\n• Spanish: Repintar paredes",
  );
  await resetKv();
});

Deno.test("REQ-262 handle-chat-message integration: the quote-phase prompt demands plain text too", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const fx = fresh();
  await seedOnboarded("u-1");
  const conv = await fx.conversations.create({ userId: "u-1" });
  let prompt = "";
  fx.llm.setHandler((req) => {
    prompt = req.systemPrompt;
    return { text: "ok" };
  });
  await fx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "Quote for Bryant: gutter cleaning $220.",
  });
  assert(
    /plain text/i.test(prompt) && /markdown/i.test(prompt),
    "no plain-text rule in systemQuote",
  );
  await resetKv();
});

// --- REQ-331 (demo-loop cycle 1, m7): the chat path binds a named customer --

Deno.test("REQ-331 m7: create_quote 'for <Name>' resolves an existing same-owner customer and binds conv.customerId + quote.customerId", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, quotes, customers, flow } = fresh();
  await seedOnboarded("u-1");
  const maria = await customers.create("u-1", {
    name: "María López",
    phoneNumber: "(512) 555-0199",
  });
  await customers.create("u-2", { name: "Maria Lopez" }); // another owner's
  llm.setScript([{
    text: "Here's your quote.",
    action: {
      type: "create_quote",
      payload: {
        summary: "Quote: Interior paint",
        lineItems: [{ description: "Paint 3 rooms", amountCents: 90_000 }],
      },
    },
  }]);
  const conv = await conversations.create({ userId: "u-1" });
  const result = await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content:
      "Quote for customer Maria Lopez, paint 3 rooms, $900, start Monday",
  });
  assertEquals(result.conversation.customerId, maria.id);
  const card = result.newMessages.find((m) => m.kind === "action_card")!;
  const quoteId = (card.payload as { quoteId: string }).quoteId;
  assertEquals((await quotes.getOwned(quoteId, "u-1")).customerId, maria.id);
  await resetKv();
});

Deno.test("REQ-331 m7: create_quote for a name nobody has binds nothing (never a guess)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, customers, flow } = fresh();
  await seedOnboarded("u-1");
  await customers.create("u-1", { name: "María López" });
  llm.setScript([{
    text: "Here's your quote.",
    action: {
      type: "create_quote",
      payload: {
        summary: "Quote: Fence",
        lineItems: [{ description: "Fence", amountCents: 50_000 }],
      },
    },
  }]);
  const conv = await conversations.create({ userId: "u-1" });
  const result = await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "Quote for Ana Ruiz, fence $500",
  });
  assertEquals(result.conversation.customerId, undefined);
  await resetKv();
});

Deno.test("REQ-331 m7/m44: with a customer bound, the lock CTA names them instead of asking Business or Person", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, quotes, customers, flow } = fresh();
  await seedOnboarded("u-1");
  const maria = await customers.create("u-1", { name: "María López" });
  const draft = await quotes.create("u-1", {
    summary: "x",
    lineItems: [],
    status: "draft",
    customerId: maria.id,
  });
  const conv = await conversations.create({
    userId: "u-1",
    quoteId: draft.id,
    customerId: maria.id,
  });
  llm.setScript([{
    text: "Locked.",
    action: { type: "lock_quote", payload: { quoteId: draft.id } },
  }]);
  const result = await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "lock it in",
  });
  const cta = result.newMessages.find((m) => m.kind === "continue_cta")!;
  assertEquals(
    cta.content,
    t("en", "chatCoordinator.lockedToTermsCtaKnown", { name: "María López" }),
  );
  assertEquals(
    (cta.payload as { customerName?: string }).customerName,
    "María López",
  );
  assert(!/business or a person/i.test(cta.content));
  await resetKv();
});

// ---------------------------------------------------------------------------
// REQ-315 (demo-loop cycle 1: B2, M26, m49). Demo pair 5 sent Dana's $9,500
// bathroom quote and then asked the assistant to "change plumbing fixtures to
// $1,300 on Q-001": the only tool that touched an existing job (change_order)
// appended "Adjust plumbing fixtures to $1,300 ($150.00)" as a FIFTH line.
// "Change order for Dana Whitfield on Q-001: add a heated floor, $1,200."
// asked "Which customer's job is this change order for?" although both the
// customer and the quote were named, and the reply never linked the quote.
// ---------------------------------------------------------------------------

/** Dana Whitfield's four-line $9,500 bathroom remodel (demo pair 5). */
async function seedDana(
  f: ReturnType<typeof fresh>,
  status: "draft" | "sent" | "accepted",
) {
  await seedOnboarded("u-1");
  const dana = await f.customers.create("u-1", { name: "Dana Whitfield" });
  const line = (description: string, price: number) => ({
    description,
    quantity: 1,
    unit: "ea",
    price,
  });
  const quote = await f.quotes.create("u-1", {
    summary: "Bathroom remodel — Dana Whitfield",
    jobName: "Bathroom Remodel Dana",
    customerId: dana.id,
    lineItems: [
      line("Demo and disposal", 120_000),
      line("Plumbing fixtures", 115_000),
      line("Tile floor and walls", 480_000),
      line("Vanity and lighting", 235_000),
    ],
    estimatedTotal: 950_000,
  });
  const live = status === "draft"
    ? quote
    : await f.quotes.update(quote.id, "u-1", {
      status,
      sentAt: new Date().toISOString(),
      ...(status === "accepted"
        ? { acceptedAt: new Date().toISOString() }
        : {}),
    });
  return { dana, quote: live };
}

/** The model's revise_quote call for "change plumbing fixtures to $1,300 on Q-001". */
const REPRICE_PLUMBING = {
  text: "",
  action: {
    type: "revise_quote" as const,
    payload: {
      customerName: "Dana Whitfield",
      quoteNumber: "Q-001",
      lines: [{ match: "plumbing fixtures", amountCents: 130_000 }],
      remove: [],
    },
  },
};

type RevisionPayload = {
  quoteRevision?: {
    kind: string;
    quoteId?: string;
    quoteNumber?: string;
    nextVersion?: number;
  };
  quoteUpdated?: string;
  changeOrder?: { kind: string; quoteId?: string; quoteNumber?: string };
};

Deno.test("REQ-315 M26: the model's revise_quote on Dana's sent quote reprices 'Plumbing fixtures' to $1,300 as a pending revision — four lines still, $9,500 → $9,650, no new quote", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = fresh();
  const { quote } = await seedDana(f, "sent");
  f.llm.setScript([REPRICE_PLUMBING]);
  // a NEW conversation — nothing bound, as in the demo
  const conv = await f.conversations.create({ userId: "u-1" });
  const result = await f.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content:
      "Change plumbing fixtures to $1,300 on the quote I already sent (Q-001) and send her the new version.",
  });

  await onlyQuoteIs(f, quote.id);
  const stored = await f.quotes.getOwned(quote.id, "u-1");
  // the published version the customer sees is untouched…
  assertEquals(stored.lineItems.map((l) => l.price), [
    120_000,
    115_000,
    480_000,
    235_000,
  ]);
  assertEquals(stored.estimatedTotal, 950_000);
  // …and the next version has the SAME four lines with plumbing repriced
  const pending = stored.pendingRevision as {
    lineItems: { description: string; price: number }[];
    estimatedTotal: number;
  };
  assertEquals(pending.lineItems.map((l) => [l.description, l.price]), [
    ["Demo and disposal", 120_000],
    ["Plumbing fixtures", 130_000],
    ["Tile floor and walls", 480_000],
    ["Vanity and lighting", 235_000],
  ]);
  assertEquals(pending.estimatedTotal, 965_000);
  // no quote card; the reply says what changed and where to publish it
  assertEquals(result.newMessages.some((m) => m.kind === "action_card"), false);
  const reply = result.newMessages.at(-1)!;
  assertEquals(reply.role, "assistant");
  assert(
    reply.content.includes("Plumbing fixtures $1,150 → $1,300"),
    reply.content,
  );
  assert(reply.content.includes("Total $9,500 → $9,650"), reply.content);
  assert(reply.content.includes("Publish revision"), reply.content);
  assertEquals((reply.payload as RevisionPayload).quoteRevision, {
    kind: "pending_revision",
    quoteId: quote.id,
    quoteNumber: stored.number,
    nextVersion: 2,
  });
  await resetKv();
});

Deno.test("REQ-315 m49: the demo's exact 'Change order for Dana Whitfield on Q-001: add a heated floor, $1,200.' writes the revision on Q-001 — no 'which customer' question — and the reply names the quote", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = fresh();
  const { quote } = await seedDana(f, "sent");
  // the model would have drafted a new quote; it must not matter
  f.llm.setScript([NEW_QUOTE_MISTAKE]);
  const conv = await f.conversations.create({ userId: "u-1" });
  const result = await f.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content:
      "Change order for Dana Whitfield on Q-001: add a heated floor, $1,200.",
  });

  await onlyQuoteIs(f, quote.id);
  const stored = await f.quotes.getOwned(quote.id, "u-1");
  assertEquals(stored.number, "Q-001");
  const pending = stored.pendingRevision as {
    lineItems: {
      description: string;
      quantity?: number;
      unit?: string;
      price: number;
    }[];
    estimatedTotal: number;
  };
  assertEquals(pending.lineItems.length, 5);
  assertEquals(pending.lineItems.at(-1), {
    description: "Heated floor",
    quantity: 1,
    unit: "ea",
    price: 120_000,
  });
  assertEquals(pending.estimatedTotal, 1_070_000);
  const reply = result.newMessages.at(-1)!;
  assertEquals(reply.role, "assistant");
  assertEquals(/which customer/i.test(reply.content), false, reply.content);
  assert(reply.content.includes("Heated floor"), reply.content);
  assertEquals((reply.payload as RevisionPayload).changeOrder, {
    kind: "pending_revision",
    quoteId: quote.id,
    quoteNumber: "Q-001",
  });
  await resetKv();
});

Deno.test("REQ-315: revise_quote on the conversation's own draft changes the line in place and flags the quote as updated", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = fresh();
  const { quote } = await seedDana(f, "draft");
  const conv = await f.conversations.create({ userId: "u-1" });
  await f.conversations.update(conv.id, { quoteId: quote.id });
  f.llm.setScript([{
    text: "",
    action: {
      type: "revise_quote",
      payload: {
        lines: [{ match: "plumbing", amountCents: 130_000 }],
        remove: ["vanity"],
      },
    },
  }]);
  const result = await f.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "make plumbing $1,300 and drop the vanity",
  });
  await onlyQuoteIs(f, quote.id);
  const stored = await f.quotes.getOwned(quote.id, "u-1");
  assertEquals(stored.pendingRevision, undefined);
  assertEquals(stored.lineItems.map((l) => [l.description, l.price]), [
    ["Demo and disposal", 120_000],
    ["Plumbing fixtures", 130_000],
    ["Tile floor and walls", 480_000],
  ]);
  assertEquals(stored.estimatedTotal, 730_000);
  const reply = result.newMessages.at(-1)!;
  assert(reply.content.includes("removed Vanity and lighting"), reply.content);
  assert(
    reply.content.includes("Plumbing fixtures $1,150 → $1,300"),
    reply.content,
  );
  assertEquals(/publish revision/i.test(reply.content), false, reply.content);
  const payload = reply.payload as RevisionPayload;
  assertEquals(payload.quoteRevision, {
    kind: "draft_updated",
    quoteId: quote.id,
    quoteNumber: stored.number,
  });
  assertEquals(payload.quoteUpdated, quote.id);
  await resetKv();
});

Deno.test("REQ-315: a signed quote is never repriced from chat — nothing is written and the reply says so", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = fresh();
  const { quote } = await seedDana(f, "accepted");
  f.llm.setScript([REPRICE_PLUMBING]);
  const conv = await f.conversations.create({ userId: "u-1" });
  const result = await f.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "change plumbing fixtures to $1,300 on Q-001",
  });
  await onlyQuoteIs(f, quote.id);
  const stored = await f.quotes.getOwned(quote.id, "u-1");
  assertEquals(stored.pendingRevision, undefined);
  assertEquals(stored.lineItems[1].price, 115_000);
  const reply = result.newMessages.at(-1)!;
  assert(/signed/i.test(reply.content), reply.content);
  assertEquals(
    (reply.payload as RevisionPayload).quoteRevision?.kind,
    "locked",
  );
  await resetKv();
});

Deno.test("REQ-315: a line that is not on the quote writes nothing — the reply lists the quote's lines instead of guessing or appending", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = fresh();
  const { quote } = await seedDana(f, "sent");
  f.llm.setScript([{
    text: "",
    action: {
      type: "revise_quote",
      payload: {
        quoteNumber: "Q-001",
        lines: [{ match: "heated floor", amountCents: 120_000 }],
        remove: [],
      },
    },
  }]);
  const conv = await f.conversations.create({ userId: "u-1" });
  const result = await f.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "change the heated floor to $1,200 on Q-001",
  });
  await onlyQuoteIs(f, quote.id);
  const stored = await f.quotes.getOwned(quote.id, "u-1");
  assertEquals(stored.pendingRevision, undefined);
  assertEquals(stored.lineItems.length, 4);
  const reply = result.newMessages.at(-1)!;
  assert(reply.content.includes("heated floor"), reply.content);
  for (
    const name of [
      "Demo and disposal",
      "Plumbing fixtures",
      "Tile floor and walls",
      "Vanity and lighting",
    ]
  ) assert(reply.content.includes(name), reply.content);
  assertEquals(
    (reply.payload as RevisionPayload).quoteRevision?.kind,
    "no_such_line",
  );
  await resetKv();
});

Deno.test("REQ-315 M26: the demo model's own call — change_order 'Adjust plumbing fixtures to $1,300' (+$150) — reprices the line instead of appending a fifth one", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = fresh();
  const { quote } = await seedDana(f, "sent");
  // exactly what the demo's model fired (report M26)
  f.llm.setScript([{
    text: "",
    action: {
      type: "change_order",
      payload: {
        customerName: "Dana Whitfield",
        description: "Adjust plumbing fixtures to $1,300",
        deltaAmountCents: 15_000,
      },
    },
  }]);
  const conv = await f.conversations.create({ userId: "u-1" });
  const result = await f.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content:
      "Change plumbing fixtures to $1,300 on the quote I already sent (Q-001) and send her the new version.",
  });
  await onlyQuoteIs(f, quote.id);
  const stored = await f.quotes.getOwned(quote.id, "u-1");
  const pending = stored.pendingRevision as {
    lineItems: { description: string; price: number }[];
    estimatedTotal: number;
  };
  assertEquals(pending.lineItems.map((l) => [l.description, l.price]), [
    ["Demo and disposal", 120_000],
    ["Plumbing fixtures", 130_000],
    ["Tile floor and walls", 480_000],
    ["Vanity and lighting", 235_000],
  ]);
  assertEquals(pending.estimatedTotal, 965_000);
  const reply = result.newMessages.at(-1)!;
  assert(
    reply.content.includes("Plumbing fixtures $1,150 → $1,300"),
    reply.content,
  );
  assertEquals(/Adjust plumbing/i.test(reply.content), false, reply.content);
  assertEquals(
    (reply.payload as RevisionPayload).quoteRevision?.kind,
    "pending_revision",
  );
  await resetKv();
});

Deno.test("REQ-315 M26: 'Change order for Dana Whitfield on Q-001: change plumbing fixtures to $1,300' reprices the line without asking the model — no line 'Change plumbing fixtures to'", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = fresh();
  const { quote } = await seedDana(f, "sent");
  let asked = 0;
  f.llm.setHandler(() => {
    asked++;
    return NEW_QUOTE_MISTAKE;
  });
  const conv = await f.conversations.create({ userId: "u-1" });
  const result = await f.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content:
      "Change order for Dana Whitfield on Q-001: change plumbing fixtures to $1,300",
  });
  assertEquals(asked, 0, "the sentence is read without the model");
  await onlyQuoteIs(f, quote.id);
  const stored = await f.quotes.getOwned(quote.id, "u-1");
  const pending = stored.pendingRevision as {
    lineItems: { description: string; price: number }[];
  };
  assertEquals(pending.lineItems.map((l) => [l.description, l.price]), [
    ["Demo and disposal", 120_000],
    ["Plumbing fixtures", 130_000],
    ["Tile floor and walls", 480_000],
    ["Vanity and lighting", 235_000],
  ]);
  const reply = result.newMessages.at(-1)!;
  assertEquals(/which customer/i.test(reply.content), false, reply.content);
  assertEquals((reply.payload as RevisionPayload).quoteRevision, {
    kind: "pending_revision",
    quoteId: quote.id,
    quoteNumber: "Q-001",
    nextVersion: 2,
  });
  await resetKv();
});

Deno.test("REQ-315 m49: a quote number that matches no quote writes nothing and the reply names that number, not a guess by name", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = fresh();
  const { quote } = await seedDana(f, "sent");
  f.llm.setScript([NEW_QUOTE_MISTAKE]);
  const conv = await f.conversations.create({ userId: "u-1" });
  const result = await f.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content:
      "Change order for Dana Whitfield on Q-009: add a heated floor, $1,200.",
  });
  await onlyQuoteIs(f, quote.id);
  const stored = await f.quotes.getOwned(quote.id, "u-1");
  assertEquals(stored.pendingRevision, undefined);
  const reply = result.newMessages.at(-1)!;
  assert(reply.content.includes("Q-009"), reply.content);
  assertEquals(
    (reply.payload as RevisionPayload).changeOrder?.kind,
    "none",
  );
  await resetKv();
});

Deno.test("REQ-315: on a SIGNED quote with an invoice, the model's price-change change_order is still the change order for the difference (REQ-238) — the reprice guard never refuses it", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = fresh();
  const { dana, quote } = await seedDana(f, "accepted");
  const inv = await f.invoices.create("u-1", {
    quoteId: quote.id,
    customerId: dana.id,
    amount: 950_000,
    status: "sent",
  } as never);
  f.llm.setScript([{
    text: "",
    action: {
      type: "change_order",
      payload: {
        customerName: "Dana Whitfield",
        description: "Adjust plumbing fixtures to $1,300",
        deltaAmountCents: 15_000,
      },
    },
  }]);
  const conv = await f.conversations.create({ userId: "u-1" });
  const result = await f.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "Change plumbing fixtures to $1,300 on Q-001",
  });
  await onlyQuoteIs(f, quote.id);
  const stored = await f.quotes.getOwned(quote.id, "u-1");
  assertEquals(
    stored.pendingRevision,
    undefined,
    "a signed quote never changes",
  );
  const cos = await f.changeOrders.listByInvoice("u-1", inv.id);
  assertEquals(cos.length, 1);
  assertEquals(cos[0].deltaAmountCents, 15_000);
  const reply = result.newMessages.at(-1)!;
  assertEquals(
    (reply.payload as RevisionPayload).changeOrder?.kind,
    "change_order",
  );
  await resetKv();
});

// REQ-302 (demo-loop cycle 1, M29 + B1) — the chat never persists a price
// that is not a price. The demo typed "price abc": the model sent one line at
// 0 and the coordinator drafted a $0 quote with "Lock it in" offered. Then
// "-500": the bound draft was repriced to -$500, locked and sent, while the
// review card's TOTAL stayed at the stale $0.
Deno.test("REQ-302 M29 handle-chat-message integration: 'price abc' → a $0 draft is NOT persisted; the reply asks for the price", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, quotes, flow } = fresh();
  await seedOnboarded("u-1");
  llm.setScript([{
    text: "Here's your quote.",
    action: {
      type: "create_quote",
      payload: {
        summary: "Panel swap — customer x",
        lineItems: [{ description: "Panel swap", amountCents: 0 }],
      },
    },
  }]);
  const conv = await conversations.create({ userId: "u-1" });
  const result = await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "Panel swap for customer x, price abc",
  });
  assertEquals(
    result.newMessages.filter((m) => m.kind === "action_card").length,
    0,
    "no draft card for a $0 quote",
  );
  assertEquals((await quotes.listByUser("u-1")).length, 0, "nothing persisted");
  assertEquals(result.conversation.quoteId, undefined);
  const texts = result.newMessages.filter((m) =>
    m.role === "assistant" && m.kind === "text"
  );
  assertEquals(texts.length, 1);
  assertEquals(
    texts[0].content,
    t("en", "chatCoordinator.priceMissing", { item: "panel swap" }),
  );
  await resetKv();
});

// REQ-394 (demo-loop cycle 2, p9) — the price ask names the line mid-sentence,
// so its leading capital goes: the demo read "What should Recessed lighting
// installation (6 lights) cost?".
Deno.test("REQ-394 p9 handle-chat-message integration: the price ask lower-cases the line it names mid-sentence", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, flow } = fresh();
  await seedOnboarded("u-1");
  llm.setScript([{
    text: "Here's your quote.",
    action: {
      type: "create_quote",
      payload: {
        summary: "Recessed Lighting Installation — Bob",
        lineItems: [{
          description: "Recessed lighting installation (6 lights)",
          amountCents: 0,
        }],
      },
    },
  }]);
  const conv = await conversations.create({ userId: "u-1" });
  const result = await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "6 recessed lights for Bob, $abc",
  });
  const texts = result.newMessages.filter((m) =>
    m.role === "assistant" && m.kind === "text"
  );
  assertEquals(texts.length, 1);
  assertEquals(
    texts[0].content,
    "I can't use that as a price. What should recessed lighting installation (6 lights) cost? Give me a number, like $500.",
  );
  await resetKv();
});

Deno.test("REQ-302 B1 handle-chat-message integration: a -$500 reprice of the bound draft is refused — the draft keeps its price, the reply asks", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, quotes, flow } = fresh();
  await seedOnboarded("u-1");
  const draft = await quotes.create("u-1", {
    summary: "Panel swap",
    lineItems: [{ description: "Panel swap", quantity: 1, unit: "ea", price: 50_000 }],
    estimatedTotal: 50_000,
    status: "draft",
  });
  const conv = await conversations.create({ userId: "u-1", quoteId: draft.id });
  llm.setScript([{
    text: "",
    action: {
      type: "create_quote",
      payload: {
        summary: "Panel swap",
        lineItems: [{ description: "Panel swap", amountCents: -50_000 }],
      },
    },
  }]);
  const result = await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "-500",
  });
  const kept = await quotes.getOwned(draft.id, "u-1");
  assertEquals(kept.estimatedTotal, 50_000);
  assertEquals(kept.lineItems[0].price, 50_000);
  assertEquals(
    result.newMessages.filter((m) => m.kind === "action_card").length,
    0,
  );
  const texts = result.newMessages.filter((m) =>
    m.role === "assistant" && m.kind === "text"
  );
  assertEquals(texts.length, 1);
  assertEquals(
    texts[0].content,
    t("en", "chatCoordinator.priceMissing", { item: "panel swap" }),
  );
  await resetKv();
});

Deno.test("REQ-302 B1 handle-chat-message integration: a real reprice of the bound draft flags the turn with quoteUpdated so the island re-reads the total", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, quotes, flow } = fresh();
  await seedOnboarded("u-1");
  const draft = await quotes.create("u-1", {
    summary: "Panel swap",
    lineItems: [{ description: "Panel swap", quantity: 1, unit: "ea", price: 50_000 }],
    estimatedTotal: 50_000,
    status: "draft",
  });
  const conv = await conversations.create({ userId: "u-1", quoteId: draft.id });
  llm.setScript([{
    text: "",
    action: {
      type: "create_quote",
      payload: {
        summary: "Panel swap",
        lineItems: [{ description: "Panel swap", amountCents: 70_000 }],
      },
    },
  }]);
  const result = await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "make it 700",
  });
  assertEquals((await quotes.getOwned(draft.id, "u-1")).estimatedTotal, 70_000);
  assertEquals(quoteUpdatedBy(result.newMessages), draft.id);
  await resetKv();
});

// REQ-337 (demo-loop cycle 1, m6): the chat path derives the job name in
// the CONTRACTOR's language and without the summary's "— <customer>" tail.
async function seedOnboardedEs(userId: string) {
  await seedOnboarded(userId);
  const kv = await getKv();
  const row = (await kv.get<Record<string, unknown>>(["user", userId])).value!;
  await kv.set(["user", userId], { ...row, language: "es" });
}

Deno.test("REQ-337 m6 handle-chat-message integration: a Spanish contractor's chat quote is titled in sentence case without the customer tail", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, quotes, flow } = fresh();
  await seedOnboardedEs("u-es");
  llm.setScript([{
    text: "Aquí está tu cotización.",
    action: {
      type: "create_quote",
      payload: {
        summary: "Mantenimiento de jardín mensual — María López",
        lineItems: [{ description: "Mantenimiento mensual", amountCents: 12_000 }],
      },
    },
  }]);
  const conv = await conversations.create({ userId: "u-es" });
  const result = await flow.run({
    userId: "u-es",
    conversationId: conv.id,
    content: "Mantenimiento de jardín mensual para María López, $120",
  });
  const stored = await quotes.getOwned(result.conversation.quoteId!, "u-es");
  assertEquals(stored.jobName, "Mantenimiento de jardín");
  await resetKv();
});

Deno.test("REQ-337 m6 handle-chat-message integration: an English chat quote never doubles the customer into its title", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, quotes, flow } = fresh();
  await seedOnboarded("u-1");
  llm.setScript([{
    text: "Here's your quote.",
    action: {
      type: "create_quote",
      payload: {
        summary: "Bathroom remodel — Dana",
        lineItems: [{ description: "Bathroom remodel", amountCents: 850_000 }],
      },
    },
  }]);
  const conv = await conversations.create({ userId: "u-1" });
  const result = await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "Bathroom remodel for Dana Whitfield, $8,500",
  });
  const stored = await quotes.getOwned(result.conversation.quoteId!, "u-1");
  assertEquals(stored.jobName, "Bathroom Remodel");
  await resetKv();
});

Deno.test("REQ-337 m6 handle-chat-message integration: a model-supplied jobName on create_quote is stored over the derived one", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, quotes, flow } = fresh();
  await seedOnboarded("u-1");
  llm.setScript([{
    text: "Here's your quote.",
    action: {
      type: "create_quote",
      payload: {
        summary: "Repaint 3 bedrooms and hallway — John Miller",
        jobName: "Bedroom & Hallway Repaint",
        lineItems: [{ description: "Repaint", amountCents: 240_000 }],
      },
    },
  }]);
  const conv = await conversations.create({ userId: "u-1" });
  const result = await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "Repaint 3 bedrooms and the hallway for John Miller, $2,400",
  });
  const stored = await quotes.getOwned(result.conversation.quoteId!, "u-1");
  assertEquals(stored.jobName, "Bedroom & Hallway Repaint");
  await resetKv();
});

// ---------------------------------------------------------------------------
// REQ-377 (demo-loop cycle 2, B1): "Dana wants a tile backsplash too — change
// Q-001 to $19,750" on Dana's sent $18,500 kitchen quote added "Tile
// backsplash ($125.00)" — the model's own cents subtraction (12500, not
// 125000), written unchecked. The new total is now read and subtracted in
// code, and a model delta that fits nothing the contractor typed is fixed or
// asked about — never written.
// ---------------------------------------------------------------------------

const PAIR5_TEXT = "Dana wants a tile backsplash too — change Q-001 to $19,750";

/** Dana Price's sent $18,500 kitchen remodel (demo pair 5), bound to a chat. */
async function seedKitchen(f: ReturnType<typeof fresh>) {
  await seedOnboarded("u-1");
  const dana = await f.customers.create("u-1", { name: "Dana Price" });
  const line = (description: string, price: number) => ({
    description,
    quantity: 1,
    unit: "ea",
    price,
  });
  const draft = await f.quotes.create("u-1", {
    summary: "Kitchen Remodel — Dana Price",
    jobName: "Kitchen Remodel",
    customerId: dana.id,
    lineItems: [
      line("Install new cabinets", 1_100_000),
      line("Install quartz countertops", 750_000),
    ],
    estimatedTotal: 1_850_000,
  });
  const quote = await f.quotes.update(draft.id, "u-1", {
    status: "sent",
    sentAt: new Date().toISOString(),
  });
  const conv = await f.conversations.create({
    userId: "u-1",
    quoteId: quote.id,
  });
  return { quote, conv };
}

type Pending = {
  lineItems: { description: string; price: number }[];
  estimatedTotal: number;
};

/** What the demo's model fired: the right tool, a tenth of the money. */
const TENTH_OF_THE_PRICE = {
  text: "",
  action: {
    type: "change_order" as const,
    payload: {
      quoteNumber: "Q-001",
      description: "Tile backsplash",
      deltaAmountCents: 12_500,
    },
  },
};

Deno.test("REQ-377 B1: the demo's exact sentence adds Tile backsplash at $1,250 — total $19,750 — whatever the model would have said", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = fresh();
  const { quote, conv } = await seedKitchen(f);
  f.llm.setScript([TENTH_OF_THE_PRICE]);
  const result = await f.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: PAIR5_TEXT,
  });
  await onlyQuoteIs(f, quote.id);
  const stored = await f.quotes.getOwned(quote.id, "u-1");
  assertEquals(stored.estimatedTotal, 1_850_000, "the live version waits");
  const pending = stored.pendingRevision as Pending;
  assertEquals(pending.lineItems.map((l) => [l.description, l.price]), [
    ["Install new cabinets", 1_100_000],
    ["Install quartz countertops", 750_000],
    ["Tile backsplash", 125_000],
  ]);
  assertEquals(pending.estimatedTotal, 1_975_000);
  const reply = result.newMessages.at(-1)!;
  assert(reply.content.includes("$1,250.00"), reply.content);
  assertEquals(reply.content.includes("$125.00"), false, reply.content);
  assertEquals((reply.payload as RevisionPayload).changeOrder, {
    kind: "pending_revision",
    quoteId: quote.id,
    quoteNumber: "Q-001",
  });
  await resetKv();
});

Deno.test("REQ-377 B1: a second new total is measured from the pending revision, not the published quote", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = fresh();
  const { quote, conv } = await seedKitchen(f);
  await f.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: PAIR5_TEXT,
  });
  await f.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "add under-cabinet lighting — change Q-001 to $20,600",
  });
  const pending = (await f.quotes.getOwned(quote.id, "u-1"))
    .pendingRevision as Pending;
  assertEquals(
    pending.lineItems.at(-1),
    {
      description: "Under-cabinet lighting",
      quantity: 1,
      unit: "ea",
      price: 85_000,
    } as unknown as Pending["lineItems"][number],
  );
  assertEquals(pending.estimatedTotal, 2_060_000);
  await resetKv();
});

Deno.test("REQ-377 B1: a new total with no item asks what the difference is for — nothing is written", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = fresh();
  const { quote, conv } = await seedKitchen(f);
  f.llm.setScript([TENTH_OF_THE_PRICE]);
  const result = await f.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "change Q-001 to $19,750",
  });
  const stored = await f.quotes.getOwned(quote.id, "u-1");
  assertEquals(stored.pendingRevision ?? undefined, undefined);
  const reply = result.newMessages.at(-1)!;
  assert(reply.content.includes("$1,250.00"), reply.content);
  assert(reply.content.includes("$19,750.00"), reply.content);
  assertEquals(
    (reply.payload as RevisionPayload).changeOrder?.kind,
    "needs_description",
  );
  await resetKv();
});

Deno.test("REQ-377 B1: the model's own change_order delta is cross-checked against the dollars typed — a decimal slip is corrected", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = fresh();
  const { quote, conv } = await seedKitchen(f);
  f.llm.setScript([TENTH_OF_THE_PRICE]);
  // phrased so no deterministic reader catches it: the model's call runs
  const result = await f.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "Dana wants a tile backsplash too, so Q-001 comes out at $19,750",
  });
  const pending = (await f.quotes.getOwned(quote.id, "u-1"))
    .pendingRevision as Pending;
  assertEquals(pending.lineItems.at(-1)?.price, 125_000);
  assertEquals(pending.estimatedTotal, 1_975_000);
  assert(result.newMessages.at(-1)!.content.includes("$1,250.00"));
  await resetKv();
});

Deno.test("REQ-377 B1: a model delta that fits no dollar amount typed is asked about — nothing is written", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = fresh();
  const { quote, conv } = await seedKitchen(f);
  f.llm.setScript([{
    ...TENTH_OF_THE_PRICE,
    action: {
      ...TENTH_OF_THE_PRICE.action,
      payload: {
        ...TENTH_OF_THE_PRICE.action.payload,
        deltaAmountCents: 99_900,
      },
    },
  }]);
  const result = await f.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "Dana wants a tile backsplash too, so Q-001 comes out at $19,750",
  });
  const stored = await f.quotes.getOwned(quote.id, "u-1");
  assertEquals(stored.pendingRevision ?? undefined, undefined);
  const reply = result.newMessages.at(-1)!;
  assertEquals(reply.content.includes("$999.00"), false, reply.content);
  assertEquals(
    (reply.payload as RevisionPayload).changeOrder?.kind,
    "needs_amount",
  );
  await resetKv();
});

Deno.test("REQ-377 B1: change_order's targetTotalCents (the tool's new-total field) is subtracted in code", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = fresh();
  const { quote, conv } = await seedKitchen(f);
  f.llm.setScript([{
    text: "",
    action: {
      type: "change_order",
      payload: {
        quoteNumber: "Q-001",
        description: "Tile backsplash",
        deltaAmountCents: 0,
        targetTotalCents: 1_975_000,
      },
    },
  }]);
  await f.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "Dana wants a tile backsplash too, so Q-001 comes out at $19,750",
  });
  const pending = (await f.quotes.getOwned(quote.id, "u-1"))
    .pendingRevision as Pending;
  assertEquals(pending.lineItems.at(-1)?.price, 125_000);
  assertEquals(pending.estimatedTotal, 1_975_000);
  await resetKv();
});

// --- REQ-386 (demo-loop cycle 2, m17): "Bob wants …" binds the existing Bob --

Deno.test("REQ-386 m17: create_quote after 'Bob wants 6 recessed lights' binds the contractor's existing Bob", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, quotes, customers, flow } = fresh();
  await seedOnboarded("u-1");
  const bob = await customers.create("u-1", {
    name: "Bob",
    phoneNumber: "(512) 555-0142",
  });
  await customers.create("u-2", { name: "Bob" }); // another owner's
  llm.setScript([{
    text: "Here's your quote.",
    action: {
      type: "create_quote",
      payload: {
        summary: "Quote: Recessed lights",
        lineItems: [{ description: "6 recessed lights", amountCents: 90_000 }],
      },
    },
  }]);
  const conv = await conversations.create({ userId: "u-1" });
  const result = await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "Need a quote: Bob wants 6 recessed lights kitchen $900",
  });
  assertEquals(result.conversation.customerId, bob.id);
  const card = result.newMessages.find((m) => m.kind === "action_card")!;
  const quoteId = (card.payload as { quoteId: string }).quoteId;
  assertEquals((await quotes.getOwned(quoteId, "u-1")).customerId, bob.id);
  await resetKv();
});

Deno.test("REQ-386 m17: a known customer named mid-sentence without a lead-in ('… Maria Gutierrez, zip 78745') is bound", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, customers, flow } = fresh();
  await seedOnboarded("u-1");
  const maria = await customers.create("u-1", { name: "Maria Gutierrez" });
  llm.setScript([{
    text: "Here's your quote.",
    action: {
      type: "create_quote",
      payload: {
        summary: "Quote: Master bath",
        lineItems: [{ description: "Bath gut", amountCents: 2_800_000 }],
      },
    },
  }]);
  const conv = await conversations.create({ userId: "u-1" });
  const result = await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content:
      "Master bath gut for the Gutierrez family. Maria Gutierrez, zip 78745, $28,000",
  });
  assertEquals(result.conversation.customerId, maria.id);
  await resetKv();
});

// REQ-375 (demo-loop cycle 2, M11): after the send, the assistant said "To
// change the quote, please tap Re-open on the quote card above" — the sent
// know-my-price quote had no card, and Re-open can't un-send anyway. The terms
// prompt now follows the bound quote's state, and revise_quote is offered.
// ---------------------------------------------------------------------------

const TAP_REOPEN = /tap Re-open on the quote card/i;

Deno.test("REQ-375 M11: a sent quote in the terms phase — the model is never told to send the contractor to Re-open, and is offered revise_quote", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const fx = fresh();
  const { conv } = await wizardQuoteInTerms(fx, "sent");
  let prompt = "";
  let tools: readonly string[] = [];
  fx.llm.setHandler((req) => {
    prompt = req.systemPrompt;
    tools = req.tools ?? [];
    return { text: "ok" };
  });
  await fx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "can I change the price on the one I sent?",
  });
  assert(prompt, "LLM was not called");
  assert(!TAP_REOPEN.test(prompt), prompt);
  assert(/next Version/.test(prompt), "the prompt says a change is the next Version");
  assert(tools.includes("revise_quote"), `tools: ${tools}`);
  await resetKv();
});

Deno.test("REQ-375 M11: the model's revise_quote in the terms phase on the bound sent quote saves Version 2 and says where to publish it", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const fx = fresh();
  const { quote, conv } = await wizardQuoteInTerms(fx, "sent");
  fx.llm.setScript([{
    text: "",
    action: {
      type: "revise_quote",
      payload: {
        lines: [{ match: "kitchen repaint", amountCents: 200_000 }],
        remove: [],
      },
    },
  }]);
  const res = await fx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "make the kitchen repaint $2,000",
  });
  const stored = await fx.quotes.getOwned(quote.id, "u-1");
  assertEquals(stored.estimatedTotal, 180_000, "the sent version is untouched");
  assertEquals(
    (stored.pendingRevision as { estimatedTotal?: number } | undefined)
      ?.estimatedTotal,
    200_000,
  );
  const reply = res.newMessages.at(-1)!;
  assertEquals(reply.role, "assistant");
  assert(/Version 2/.test(reply.content), reply.content);
  assert(!/Re-open/i.test(reply.content), reply.content);
  await resetKv();
});

Deno.test("REQ-375 M11: a locked, unsent quote with its card in the thread — Re-open on the card is offered as the by-hand path", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const fx = fresh();
  const { quote, conv } = await wizardQuoteInTerms(fx, "draft");
  await fx.quotes.update(quote.id, "u-1", {
    lockedAt: "2026-11-12T05:00:00Z",
  } as never);
  await fx.messages.append({
    conversationId: conv.id,
    role: "assistant",
    kind: "action_card",
    content: "Kitchen repaint",
    payload: { actionType: "quote", status: "locked", quoteId: quote.id },
  });
  let prompt = "";
  fx.llm.setHandler((req) => {
    prompt = req.systemPrompt;
    return { text: "ok" };
  });
  await fx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "how do I change the price?",
  });
  assert(TAP_REOPEN.test(prompt), prompt);
  await resetKv();
});

// REQ-418 (demo-loop cycle 2, M27): "Client form prefills the phone number
// into the job address". The model's serviceAddress is only kept when it is
// address-shaped and grounded in a user turn; the deterministic extractor
// wins over it.
// ---------------------------------------------------------------------------

const M27_DEMO =
  "Cotización rápida: reparar puerta de baño para Maria Lopez, 512-555-0199, $250";

async function runWithModelAddress(content: string, serviceAddress: string) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, quotes, flow } = fresh();
  await seedOnboarded("u-1");
  // the model's value goes straight into the payload, as a hostile/buggy
  // provider would send it — the coordinator must check it itself.
  llm.setScript([{
    text: "Aquí está tu cotización.",
    action: {
      type: "create_quote",
      payload: {
        summary: "Cotización: reparar puerta de baño — Maria Lopez",
        serviceAddress,
        lineItems: [{ description: "Reparar puerta de baño", amountCents: 25_000 }],
      },
    },
  }]);
  const conv = await conversations.create({ userId: "u-1" });
  const result = await flow.run({ userId: "u-1", conversationId: conv.id, content });
  const stored = await quotes.getOwned(result.conversation.quoteId!, "u-1");
  await resetKv();
  return stored;
}

Deno.test("REQ-418 handle-chat-message integration: the model's phone-as-address is not stored (the demo's exact sentence)", async () => {
  for (const bad of ["512-555-0199", "Maria Lopez, 512-555-0199"]) {
    const stored = await runWithModelAddress(M27_DEMO, bad);
    assertEquals(stored.serviceAddress ?? null, null, `stored ${bad}`);
  }
});

Deno.test("REQ-418 handle-chat-message integration: an address the user never typed is not stored", async () => {
  const stored = await runWithModelAddress(M27_DEMO, "123 Main St, Austin TX");
  assertEquals(stored.serviceAddress ?? null, null);
});

Deno.test("REQ-418 handle-chat-message integration: the typed address wins over the model's", async () => {
  const stored = await runWithModelAddress(
    "Deep clean for Maria Lopez, 412 Oak St Austin, $350",
    "Oak St",
  );
  assertEquals(stored.serviceAddress, "412 Oak St Austin");
});

// ── REQ-439 (demo-loop cycle 3, M9): a first draft has a line for every item
// the contractor typed. Pair 7's all-Spanish master bath named a shower bench
// and possible mold; the first create_quote had neither, and nothing checked.
const M9_BATH =
  'Baño principal: quitar la tina vieja, regadera walk-in con vidrio frameless de 60", ' +
  "145 sq ft de porcelanato en piso y paredes, vanity doble, extractor nuevo, mover el contacto GFCI, " +
  "pintura y drywall. Banco en la regadera. Posible moho detrás de la pared, allowance para remediación. " +
  "Empezamos después de Año Nuevo.";
const M9_DRAFT = [
  { description: "Quitar la tina vieja", amountCents: 40_000 },
  { description: 'Regadera walk-in con vidrio frameless de 60"', amountCents: 600_000 },
  { description: "Porcelanato en piso y paredes, 145 sq ft", amountCents: 450_000 },
  { description: "Instalar vanity doble", amountCents: 180_000 },
  { description: "Extractor nuevo", amountCents: 35_000 },
  { description: "Mover el contacto GFCI", amountCents: 25_000 },
  { description: "Pintura y drywall", amountCents: 120_000 },
];
const M9_FULL = [
  ...M9_DRAFT,
  { description: "Banco en la regadera", amountCents: 90_000 },
  { description: "Allowance de remediación de moho", amountCents: 150_000 },
];
const createQuote = (lineItems: typeof M9_DRAFT) => ({
  text: "",
  action: { type: "create_quote" as const, payload: { summary: "Remodelación de baño principal", lineItems } },
});

Deno.test("REQ-439 (M9) a first draft missing typed items (the bench, the mold) is asked again once with them listed; the draft with their lines is stored", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, quotes, flow } = fresh();
  await seedOnboarded("u-1");
  const calls: string[][] = [];
  llm.setHandler((req) => {
    calls.push(req.messages.map((m) => String(m.content)));
    return calls.length === 1 ? createQuote(M9_DRAFT) : createQuote(M9_FULL);
  });
  const conv = await conversations.create({ userId: "u-1" });
  const result = await flow.run({ userId: "u-1", conversationId: conv.id, content: M9_BATH });
  assertEquals(calls.length, 2, "re-asked exactly once");
  const reask = calls[1].at(-1) ?? "";
  assert(/banco en la regadera/i.test(reask), `the re-ask names the bench: ${reask}`);
  assert(/moho/i.test(reask), `the re-ask names the mold: ${reask}`);
  assert(!/tina vieja|vanity doble/i.test(reask), `the re-ask lists items the draft already has: ${reask}`);
  const stored = await quotes.getOwned(result.conversation.quoteId!, "u-1");
  const lines = stored.lineItems.map((l) => l.description);
  assert(lines.some((d) => /banco/i.test(d)), JSON.stringify(lines));
  assert(lines.some((d) => /moho/i.test(d)), JSON.stringify(lines));
  await resetKv();
});

Deno.test("REQ-439 (M9) a first draft with a line for every typed item is not asked again", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, quotes, flow } = fresh();
  await seedOnboarded("u-1");
  let n = 0;
  llm.setHandler(() => (n++, createQuote(M9_FULL)));
  const conv = await conversations.create({ userId: "u-1" });
  const result = await flow.run({ userId: "u-1", conversationId: conv.id, content: M9_BATH });
  assertEquals(n, 1);
  const stored = await quotes.getOwned(result.conversation.quoteId!, "u-1");
  assertEquals(stored.lineItems.length, M9_FULL.length);
  await resetKv();
});

// REQ-447 (demo-loop cycle 3, m14): the job has ONE name. The first message
// used to title the thread ("Repaint 3 bedrooms and the hallway for John
// Miller, $2,400") while the quote it drafted was "Bedroom & Hallway Repaint".
Deno.test("REQ-447 m14 handle-chat-message integration: the quote a turn drafts titles the conversation by its jobName, even on the first message", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, quotes, flow } = fresh();
  await seedOnboarded("u-1");
  llm.setScript([{
    text: "Here's your quote.",
    action: {
      type: "create_quote",
      payload: {
        summary: "Repaint 3 bedrooms and hallway — John Miller",
        jobName: "Bedroom & Hallway Repaint",
        lineItems: [{ description: "Repaint", amountCents: 240_000 }],
      },
    },
  }]);
  const conv = await conversations.create({ userId: "u-1" });
  const result = await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "Repaint 3 bedrooms and the hallway for John Miller, $2,400",
  });
  const stored = await quotes.getOwned(result.conversation.quoteId!, "u-1");
  assertEquals(result.conversation.title, stored.jobName);
  assertEquals(
    (await conversations.get(conv.id)).title,
    "Bedroom & Hallway Repaint",
  );
  await resetKv();
});

Deno.test("REQ-447 m14 handle-chat-message integration: a plain first message still titles a thread with no quote", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, flow } = fresh();
  await seedOnboarded("u-1");
  llm.setScript([{ text: "Sure — what's the job?" }]);
  const conv = await conversations.create({ userId: "u-1" });
  const result = await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "Need help pricing a fence",
  });
  assertEquals(result.conversation.title, "Need help pricing a fence");
  await resetKv();
});

// ---------------------------------------------------------------------------
// REQ-435 (demo-loop cycle 3, M4): the draft action_card carries the job
// address the quote was stored with, house number included, so the chat's
// draft card can show it.
// ---------------------------------------------------------------------------

Deno.test("REQ-435 M4 handle-chat-message integration: the draft action_card carries the stored serviceAddress, house number kept (the demo's sentence)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, quotes, flow } = fresh();
  await seedOnboarded("u-1");
  llm.setScript([{
    text: "Here's your quote.",
    action: {
      type: "create_quote",
      payload: {
        summary: "Quote: Paint living room — Linda Moreno",
        lineItems: [{ description: "Paint living room", amountCents: 185_000 }],
      },
    },
  }]);
  const conv = await conversations.create({ userId: "u-1" });
  const result = await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content:
      "Paint my living room and hallway, $1,850. It's for Linda Moreno. Her phone 512-555-0177, linda.moreno@example.com, 4410 Avenue F Austin TX 78751",
  });
  const stored = await quotes.getOwned(result.conversation.quoteId!, "u-1");
  assertEquals(stored.serviceAddress, "4410 Avenue F Austin TX 78751");
  const card = result.newMessages.find((m) => m.kind === "action_card");
  assertEquals(
    (card?.payload as { serviceAddress?: string } | undefined)?.serviceAddress,
    "4410 Avenue F Austin TX 78751",
  );
  await resetKv();
});

Deno.test("handle-chat-message integration: REQ-465 (demo cycle 3, m37) the chat 'lock_quote' card and the 'create_quote' draft card carry the quote's number", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, quotes, flow } = fresh();
  await seedOnboarded("u-1");

  llm.setScript([{
    text: "Here's your quote.",
    action: {
      type: "create_quote",
      payload: {
        summary: "Quote: Fence repair",
        lineItems: [{ description: "Fence repair", amountCents: 50_000 }],
      },
    },
  }]);
  const conv = await conversations.create({ userId: "u-1" });
  const drafted = await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "draft the quote",
  });
  const draftCard = drafted.newMessages.find((m) => m.kind === "action_card");
  const draftPayload = draftCard?.payload as
    | { quoteId?: string; number?: string }
    | undefined;
  assert(draftPayload?.quoteId, "draft card names its quote");
  const stored = await quotes.getOwned(draftPayload.quoteId, "u-1");
  assert(stored.number, "the quote is numbered at create");
  assertEquals(draftPayload.number, stored.number);

  llm.setScript([{
    text: "Locked.",
    action: { type: "lock_quote", payload: { quoteId: stored.id } },
  }]);
  const locked = await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "lock it in",
  });
  const lockCard = locked.newMessages.find((m) => m.kind === "action_card");
  const lockPayload = lockCard?.payload as
    | { status?: string; number?: string }
    | undefined;
  assertEquals(lockPayload?.status, "locked");
  assertEquals(lockPayload?.number, stored.number);
  await resetKv();
});

// --- REQ-576 (demo-loop cycle 4, m26): the summary's "— <Name>" binds the
// contractor's own customer. Pair 10's card read "Electrical outlet
// installation — Bob Smith" while Bob was saved, yet the thread stayed
// unbound and the wizard asked "Is this for a business or a person?". -------

const outletScript = (summary: string) => [{
  text: "Here's your quote.",
  action: {
    type: "create_quote" as const,
    payload: {
      summary,
      lineItems: [{ description: "Install 4 outlets", amountCents: 60_000 }],
    },
  },
}];

Deno.test("REQ-576 m26: create_quote whose summary names one saved customer ('— Bob Smith') binds them though the typed text has no usable name", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, quotes, customers, flow } = fresh();
  await seedOnboarded("u-1");
  const bob = await customers.create("u-1", {
    name: "Bob Smith",
    phoneNumber: "(512) 555-0142",
  });
  await customers.create("u-2", { name: "Bob Smith" }); // another owner's
  llm.setScript(outletScript("Electrical outlet installation — Bob Smith"));
  const conv = await conversations.create({ userId: "u-1" });
  const result = await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "4 outlets for bob smith, 555 phone, $150 each",
  });
  assertEquals(result.conversation.customerId, bob.id);
  const card = result.newMessages.find((m) => m.kind === "action_card")!;
  const quoteId = (card.payload as { quoteId: string }).quoteId;
  assertEquals((await quotes.getOwned(quoteId, "u-1")).customerId, bob.id);
  await resetKv();
});

Deno.test("REQ-576 m26: with the summary's customer bound, the lock CTA names them instead of asking Business or Person", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, customers, flow } = fresh();
  await seedOnboarded("u-1");
  await customers.create("u-1", { name: "Bob Smith" });
  const conv = await conversations.create({ userId: "u-1" });
  llm.setScript(outletScript("Electrical outlet installation — Bob Smith"));
  const first = await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "4 outlets, $150 each",
  });
  const card = first.newMessages.find((m) => m.kind === "action_card")!;
  const quoteId = (card.payload as { quoteId: string }).quoteId;
  llm.setScript([{
    text: "Locked.",
    action: { type: "lock_quote", payload: { quoteId } },
  }]);
  const result = await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "lock it in",
  });
  const cta = result.newMessages.find((m) => m.kind === "continue_cta")!;
  assertEquals(
    (cta.payload as { customerName?: string }).customerName,
    "Bob Smith",
  );
  assert(!/business or a person/i.test(cta.content));
  await resetKv();
});

Deno.test("REQ-576 m26: a summary naming two saved customers of that name, or nobody saved, binds nothing and creates no customer", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, customers, flow } = fresh();
  await seedOnboarded("u-1");
  await customers.create("u-1", { name: "Bob Smith" });
  await customers.create("u-1", { name: "Bob Smith" });
  llm.setScript(outletScript("Outlets — Bob Smith"));
  const c1 = await conversations.create({ userId: "u-1" });
  const r1 = await flow.run({
    userId: "u-1",
    conversationId: c1.id,
    content: "4 outlets, $150 each",
  });
  assertEquals(r1.conversation.customerId, undefined);

  llm.setScript(outletScript("Outlets — Ana Ruiz"));
  const c2 = await conversations.create({ userId: "u-1" });
  const r2 = await flow.run({
    userId: "u-1",
    conversationId: c2.id,
    content: "4 outlets, $150 each",
  });
  assertEquals(r2.conversation.customerId, undefined);
  assertEquals((await customers.listByUser("u-1")).length, 2);
  await resetKv();
});
