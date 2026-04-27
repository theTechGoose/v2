import { assert, assertEquals, assertRejects } from "#std/assert";
import { HandleChatMessage } from "./mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { StubLLMClient } from "@agents/domain/llm/stub/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { ContractStore } from "@paperwork/domain/data/contract-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { SendPaperworkEmail } from "@paperwork/domain/coordinators/send-paperwork-email/mod.ts";
import { EmailService, type SendEmailInput } from "@communication/domain/email/mod.ts";
import { EventBus, type DomainEvent } from "@core/events/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

function fresh() {
  const conversations = new AgentConversationStore();
  const messages = new AgentMessageStore();
  const llm = new StubLLMClient();
  const quotes = new QuoteStore();
  const contracts = new ContractStore();
  const invoices = new InvoiceStore();
  const customers = new CustomerStore();
  const bus = new EventBus();
  const email = new EmailService();
  const sentEmails: SendEmailInput[] = [];
  email.send = async (input: SendEmailInput) => {
    sentEmails.push(input);
    return { ok: true, reason: "test_capture" };
  };
  const emailer = new SendPaperworkEmail(quotes, contracts, invoices, customers, email);
  const flow = new HandleChatMessage(conversations, messages, quotes, bus, emailer, llm);
  return { conversations, messages, llm, quotes, contracts, invoices, customers, bus, email, emailer, sentEmails, flow };
}

Deno.test("handle-chat-message integration: appends [user, assistant] messages and updates preview", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, messages, llm, flow } = fresh();
  llm.setScript([{ text: "Got it — what zip code is the job in?" }]);

  const conv = await conversations.create({ userId: "u-1" });
  const result = await flow.run({ userId: "u-1", conversationId: conv.id, content: "Garage epoxy floor for the Hernandez family" });

  assertEquals(result.newMessages.length, 2);
  assertEquals(result.newMessages[0].role, "user");
  assertEquals(result.newMessages[1].role, "assistant");
  assertEquals(result.newMessages[1].content, "Got it — what zip code is the job in?");
  assertEquals((await messages.listByConversation(conv.id)).length, 2);
  assertEquals(result.conversation.preview, "Got it — what zip code is the job in?");
  assertEquals(result.conversation.title, "Garage epoxy floor for the Hernandez family");
  await resetKv();
});

Deno.test("handle-chat-message integration: cross-user access is forbidden", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, flow } = fresh();
  const conv = await conversations.create({ userId: "u-1" });
  await assertRejects(
    () => flow.run({ userId: "u-2", conversationId: conv.id, content: "intruder" }),
    Error,
    "forbidden",
  );
  await resetKv();
});

Deno.test("handle-chat-message integration: action 'create_quote' creates a real Quote AND emits an action_card", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, quotes, flow } = fresh();
  llm.setScript([{
    text: "Here's your quote.",
    action: {
      type: "create_quote",
      payload: {
        customerId: "cust-1",
        summary: "Quote: 2-Car Garage Epoxy Floor",
        lineItems: [
          { description: "Surface prep + grind", amountCents:  84_000 },
          { description: "Polyaspartic 3-coat",  amountCents: 168_000 },
        ],
      },
    },
  }]);

  const conv = await conversations.create({ userId: "u-1" });
  const result = await flow.run({ userId: "u-1", conversationId: conv.id, content: "draft the quote" });

  assertEquals(result.newMessages.length, 3);
  const card = result.newMessages[2];
  assertEquals(card.kind, "action_card");
  const cardPayload = card.payload as { actionType: string; quoteId: string; totalCents: number };
  assertEquals(cardPayload.actionType, "quote");
  assertEquals(cardPayload.totalCents, 252_000);
  assert(typeof cardPayload.quoteId === "string" && cardPayload.quoteId.length > 0);

  // Quote actually exists in the paperwork store, owned by u-1, status 'draft'.
  const stored = await quotes.getOwned(cardPayload.quoteId, "u-1");
  assertEquals(stored.summary, "Quote: 2-Car Garage Epoxy Floor");
  assertEquals(stored.status, "draft");
  assertEquals(stored.lineItems.length, 2);
  assertEquals(stored.estimatedTotal, 2_520);                  // (84_000 + 168_000) / 100

  // Conversation now points at the new quote AND inherits the customer.
  assertEquals(result.conversation.quoteId, cardPayload.quoteId);
  assertEquals(result.conversation.customerId, "cust-1");

  await resetKv();
});

Deno.test("handle-chat-message integration: action 'lock_quote' uses conv.quoteId (NOT the LLM-provided one) and flips status to 'sent'", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, quotes, flow } = fresh();
  // Pre-create a real draft quote owned by u-1; bind to conversation.
  const draft = await quotes.create("u-1", { summary: "x", lineItems: [], status: "draft" });
  const conv = await conversations.create({ userId: "u-1", quoteId: draft.id });

  llm.setScript([{
    text: "Locked.",
    // LLM hallucinates a different id — coordinator must ignore it and use conv.quoteId.
    action: { type: "lock_quote", payload: { quoteId: "made-up-id" } },
  }]);
  await flow.run({ userId: "u-1", conversationId: conv.id, content: "lock it in" });
  const reloaded = await quotes.getOwned(draft.id, "u-1");
  assertEquals(reloaded.status, "sent");
  await resetKv();
});

Deno.test("handle-chat-message integration: 'create_quote' emits a 'drafted' DomainEvent on the bus", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, bus, flow } = fresh();
  const seen: DomainEvent[] = [];
  bus.subscribe((e) => { seen.push(e); });

  llm.setScript([{
    text: "ok",
    action: { type: "create_quote", payload: { summary: "x", lineItems: [{ description: "y", amountCents: 100 }] } },
  }]);
  const conv = await conversations.create({ userId: "u-1" });
  await flow.run({ userId: "u-1", conversationId: conv.id, content: "draft" });

  assertEquals(seen.length, 1);
  assertEquals(seen[0].entityType, "quote");
  assertEquals(seen[0].action, "drafted");
  assertEquals(seen[0].userId, "u-1");
  await resetKv();
});

Deno.test("handle-chat-message integration: 'lock_quote' emits a 'sent' DomainEvent", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, quotes, bus, flow } = fresh();
  const seen: DomainEvent[] = [];
  bus.subscribe((e) => { if (e.action === "sent") seen.push(e); });

  const draft = await quotes.create("u-1", { summary: "x", lineItems: [], status: "draft" });
  const conv = await conversations.create({ userId: "u-1", quoteId: draft.id });
  llm.setScript([{ text: "Locked.", action: { type: "lock_quote", payload: { quoteId: draft.id } } }]);
  await flow.run({ userId: "u-1", conversationId: conv.id, content: "lock" });

  assertEquals(seen.length, 1);
  assertEquals(seen[0].entityId, draft.id);
  await resetKv();
});

Deno.test("handle-chat-message integration: action 'request_terms_transition' appends a continue_cta carrying the active quoteId", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, flow } = fresh();
  llm.setScript([{
    text: "Want to wrap the contract terms?",
    action: { type: "request_terms_transition", payload: { quoteId: "ignored" } },
  }]);
  const conv = await conversations.create({ userId: "u-1", quoteId: "q-real" });
  const result = await flow.run({ userId: "u-1", conversationId: conv.id, content: "yeah" });

  assertEquals(result.newMessages.length, 3);
  const cta = result.newMessages[2];
  assertEquals(cta.kind, "continue_cta");
  const payload = cta.payload as { toPhase: string; quoteId: string };
  assertEquals(payload.toPhase, "terms");
  assertEquals(payload.quoteId, "q-real");                    // conv.quoteId wins
  await resetKv();
});

Deno.test("handle-chat-message integration: receives full history (LLM sees previous turns)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, flow } = fresh();
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
  const conv = await conversations.create({ userId: "u-1" });
  const r1 = await flow.run({ userId: "u-1", conversationId: conv.id, content: "First message wins title" });
  assertEquals(r1.conversation.title, "First message wins title");
  const r2 = await flow.run({ userId: "u-1", conversationId: conv.id, content: "Second never overrides" });
  assertEquals(r2.conversation.title, "First message wins title");
  await resetKv();
});

Deno.test("handle-chat-message integration: voice kind is preserved on the user message", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, flow } = fresh();
  const conv = await conversations.create({ userId: "u-1" });
  const result = await flow.run({ userId: "u-1", conversationId: conv.id, content: "I just talked", kind: "voice" });
  assertEquals(result.newMessages[0].kind, "voice");
  assert(result.newMessages[1].kind === "text", "assistant always replies in text");
  await resetKv();
});

Deno.test("handle-chat-message integration: 'lock_quote' auto-emails the linked customer", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, quotes, customers, sentEmails, flow } = fresh();
  const customer = await customers.create("u-1", { name: "Acme", email: "ops@acme.test" });
  const draft = await quotes.create("u-1", { summary: "Roof", lineItems: [], customerId: customer.id, status: "draft" });
  const conv = await conversations.create({ userId: "u-1", quoteId: draft.id, customerId: customer.id });
  llm.setScript([{ text: "Locked.", action: { type: "lock_quote", payload: { quoteId: draft.id } } }]);

  await flow.run({ userId: "u-1", conversationId: conv.id, content: "lock" });

  assertEquals(sentEmails.length, 1);
  assertEquals(sentEmails[0].to, "ops@acme.test");
  assert(sentEmails[0].subject.includes("Roof"));
  await resetKv();
});

Deno.test("handle-chat-message integration: 'lock_quote' without a customer email does NOT throw and still locks", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, quotes, sentEmails, flow } = fresh();
  // No customer linked → emailer returns ok=false but does not throw.
  const draft = await quotes.create("u-1", { summary: "Orphan", lineItems: [], status: "draft" });
  const conv = await conversations.create({ userId: "u-1", quoteId: draft.id });
  llm.setScript([{ text: "Locked.", action: { type: "lock_quote", payload: { quoteId: draft.id } } }]);

  await flow.run({ userId: "u-1", conversationId: conv.id, content: "lock" });

  // Quote still got locked.
  assertEquals((await quotes.getOwned(draft.id, "u-1")).status, "sent");
  // No SMTP call captured.
  assertEquals(sentEmails.length, 0);
  await resetKv();
});
