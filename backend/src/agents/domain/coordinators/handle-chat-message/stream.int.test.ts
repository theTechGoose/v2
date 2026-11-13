/**
 * REQ-670 (demo-loop cycle 5, p7 — "Assistant replies never stream"; the
 * backlog's c1-nc-6, c2-nc-stream, c4-nc-no-streaming): HandleChatMessage ran
 * the whole turn — the model, the tools, the re-asks, the price checks — and
 * only then returned the reply, so the chat showed typing dots and then the
 * whole reply at once (pairs 3 and 7, on both sides of the demo).
 *
 * Now a turn run with `onEvent` reports itself as it happens:
 *   - a plain answer's prose goes out while the model writes it, shaped the
 *     way the stored reply is (plain text), before the reply is saved;
 *   - a tool turn says what it is doing instead ("drafting" once the model
 *     starts a create_quote, "saving" while a change is applied) and no more
 *     of the model's prose, which the coordinator replaces;
 *   - a pricing question says "pricing" while the engine prices it;
 *   - the turn's result is the same whole turn the JSON route returns, and a
 *     turn run without `onEvent` never asks the model to stream.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { HandleChatMessage } from "./mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { StubLLMClient } from "@agents/domain/business/llm/implementations/stub/mod.ts";
import type {
  LLMRequest,
  LLMResponse,
} from "@agents/domain/business/llm/base/mod.ts";
import type { ChatTurnEvent } from "@agents/domain/business/chat-stream/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { FileStore } from "@files/domain/data/file-store/mod.ts";
import { BusinessAddressStore } from "@profile/domain/data/business-address-store/mod.ts";
import { SendPaperworkEmail } from "@paperwork/domain/coordinators/send-paperwork-email/mod.ts";
import { EmailService } from "@communication/domain/data/email-service/mod.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { ConversationStore as CommConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore as CommMessageStore } from "@communication/domain/data/message-store/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";
import { ChangeOrderStore } from "@paperwork/domain/data/change-order-store/mod.ts";
import type { SendChangeOrderAlert } from "@paperwork/domain/coordinators/send-change-order-alert/mod.ts";
import { ApplyChatChangeOrder } from "@agents/domain/coordinators/apply-chat-change-order/mod.ts";
import { ReviseQuote } from "@agents/domain/coordinators/revise-quote/mod.ts";
import type { AgentMessage } from "@agents/dto/message.ts";

/** A contractor past the assistant's onboarding questions, in Austin. */
async function seedOnboarded(userId: string) {
  const kv = await getKv();
  const now = new Date().toISOString();
  await kv.set(["user", userId], {
    id: userId,
    phoneNumber: "+15125550670",
    name: "Priya Nair",
    email: "priya@test.dev",
    language: "en",
    createdAt: now,
    updatedAt: now,
  });
  await new BusinessIdentityStore().upsert(userId, {
    businessName: "Nair Kitchen & Bath",
    acceptedPaymentMethods: { check: { enabled: true } },
  });
  await new BusinessAddressStore().upsert(userId, {
    city: "Austin",
    state: "TX",
    postal: "78704",
  });
}

function fresh() {
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
      new LogPaperworkMessage(
        new CommConversationStore(),
        new CommMessageStore(),
      ),
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
  return { conversations, messages, llm, quotes, flow };
}

const TIERS_JSON = JSON.stringify({
  options: [
    { tier: "competitive", priceCents: 180_000, rationale: "Priced to win" },
    { tier: "market", priceCents: 240_000, rationale: "Typical here" },
    { tier: "premium", priceCents: 310_000, rationale: "Fast, permit pulled" },
  ],
});

/** Pricing (JSON-mode) calls get the tiers; chat-model calls get `chat`.
 *  Every request is recorded. */
function answer(
  llm: StubLLMClient,
  chat: (req: LLMRequest) => LLMResponse,
): LLMRequest[] {
  const seen: LLMRequest[] = [];
  llm.setHandler((req) => {
    seen.push(req);
    return req.responseFormat === "json" ? { text: TIERS_JSON } : chat(req);
  });
  return seen;
}

async function setup() {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const fx = fresh();
  await seedOnboarded("u-1");
  const conv = await fx.conversations.create({ userId: "u-1" });
  return { ...fx, convId: conv.id };
}

/** What the chat's pending bubble shows after these events — the client's
 *  rule: a delta appends, a text replaces, a stage clears the prose. */
function shown(events: ChatTurnEvent[]): string {
  let text = "";
  for (const e of events) {
    if (e.type === "delta") text += e.text;
    else if (e.type === "text") text = e.text;
    else text = "";
  }
  return text;
}

const stages = (events: ChatTurnEvent[]) =>
  events.flatMap((e) => e.type === "progress" ? [e.stage] : []);
const replyOf = (msgs: AgentMessage[]) =>
  msgs.find((m) => m.role === "assistant" && m.kind === "text");

const PLAIN =
  "Most decks around Austin run $25 to $35 a square foot installed.\nTell me the size and the boards and I'll draft one.";

Deno.test("REQ-670: a plain answer streams — its prose goes out while the model writes it, before the reply is saved, and joins to the stored reply", async () => {
  const ctx = await setup();
  answer(ctx.llm, () => ({ text: PLAIN }));
  // one timeline: the turn's events and the store's writes, in order
  const log: string[] = [];
  const append = ctx.messages.append.bind(ctx.messages);
  ctx.messages.append = (m) => {
    log.push(`saved:${m.role}`);
    return append(m);
  };
  const events: ChatTurnEvent[] = [];

  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: ctx.convId,
    content: "how much do decks usually run around here?",
    onEvent: (e) => {
      events.push(e);
      log.push(`event:${e.type}`);
    },
  });

  const deltas = events.filter((e) => e.type === "delta");
  assert(deltas.length >= 3, `streamed in pieces (got ${deltas.length})`);
  assertEquals(stages(events), [], "a plain answer has no stage");
  const reply = replyOf(res.newMessages);
  assertEquals(reply?.content, PLAIN);
  assertEquals(shown(events), reply?.content, "the bubble ends as the reply");
  assert(
    log.indexOf("event:delta") < log.indexOf("saved:assistant"),
    `prose went out before the reply was saved: ${log.join(" ")}`,
  );
  assertEquals(res.newMessages.map((m) => m.role), ["user", "assistant"]);
  await resetKv();
});

Deno.test("REQ-670: the streamed prose is shaped like the stored reply — the bubble never ends on raw markdown", async () => {
  const ctx = await setup();
  answer(ctx.llm, () => ({
    text: "**Labor:** about $1,200\n- Materials: about $300",
  }));
  const events: ChatTurnEvent[] = [];
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: ctx.convId,
    content: "rough idea for a vanity swap, labor and materials?",
    onEvent: (e) => events.push(e),
  });
  const reply = replyOf(res.newMessages);
  assertEquals(reply?.content, "Labor: about $1,200\n• Materials: about $300");
  assertEquals(shown(events), reply?.content);
  await resetKv();
});

Deno.test("REQ-670: a create_quote turn — the model's prose streams, then 'drafting' and no more prose; the card comes with the whole turn", async () => {
  const ctx = await setup();
  answer(ctx.llm, () => ({
    text: "Here's the draft for the deck.",
    action: {
      type: "create_quote",
      payload: {
        summary: "Deck build — 12x16 pressure-treated",
        lineItems: [{ description: "Deck build", amountCents: 640_000 }],
      },
    },
  }));
  const events: ChatTurnEvent[] = [];
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: ctx.convId,
    content: "quote a 12x16 pressure-treated deck for the Hendersons, $6,400",
    onEvent: (e) => events.push(e),
  });
  assertEquals(stages(events), ["drafting"]);
  const at = events.findIndex((e) => e.type === "progress");
  assert(
    events.slice(at + 1).every((e) => e.type === "progress"),
    `no prose after the tool started: ${JSON.stringify(events)}`,
  );
  assert(
    events.slice(0, at).some((e) => e.type === "delta"),
    "the prose before the tool call streamed",
  );
  const card = res.newMessages.find((m) => m.kind === "action_card");
  assert(card, "the draft card comes with the turn");
  assertEquals((card!.payload as { totalCents?: number }).totalCents, 640_000);
  await resetKv();
});

Deno.test("REQ-670: a pricing question says 'pricing' first and never streams the engine's JSON — the tiers come with the whole turn", async () => {
  const ctx = await setup();
  const seen = answer(ctx.llm, () => ({ text: "(chat model answer)" }));
  const events: ChatTurnEvent[] = [];
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: ctx.convId,
    content:
      "what should i charge to move a shower drain 18 inches on a slab foundation in austin?",
    onEvent: (e) => events.push(e),
  });
  assertEquals(events[0], { type: "progress", stage: "pricing" });
  assertEquals(
    events.filter((e) => e.type !== "progress"),
    [],
    "nothing of the engine's JSON reaches the bubble",
  );
  assert(
    seen.filter((r) => r.responseFormat === "json").every((r) => !r.stream),
    "the pricing engine is never asked to stream",
  );
  assertStringIncludes(replyOf(res.newMessages)?.content ?? "", "Market:");
  await resetKv();
});

Deno.test("REQ-670: 'lock it in' on the open draft says 'saving' while the quote locks", async () => {
  const ctx = await setup();
  answer(ctx.llm, () => ({ text: "(not asked)" }));
  const quote = await ctx.quotes.create("u-1", {
    summary: "Deck build",
    lineItems: [{
      description: "Deck build",
      quantity: 1,
      unit: "ea",
      price: 640_000,
    }],
    estimatedTotal: 640_000,
    status: "draft",
  });
  await ctx.conversations.update(ctx.convId, { quoteId: quote.id });
  const events: ChatTurnEvent[] = [];
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: ctx.convId,
    content: "lock it in",
    onEvent: (e) => events.push(e),
  });
  assertEquals(stages(events), ["saving"]);
  const card = res.newMessages.find((m) => m.kind === "action_card");
  assertEquals((card?.payload as { status?: string })?.status, "locked");
  await resetKv();
});

Deno.test("REQ-670: a turn run without onEvent never asks the model to stream — the JSON route's turn is unchanged", async () => {
  const ctx = await setup();
  const seen = answer(ctx.llm, () => ({ text: PLAIN }));
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: ctx.convId,
    content: "how much do decks usually run around here?",
  });
  assert(seen.length > 0);
  assert(seen.every((r) => r.stream === undefined), "no request streamed");
  assertEquals(replyOf(res.newMessages)?.content, PLAIN);

  // …and with onEvent, the chat model's request carries the stream sink.
  const streamed = await setup();
  const asked = answer(streamed.llm, () => ({ text: PLAIN }));
  await streamed.flow.run({
    userId: "u-1",
    conversationId: streamed.convId,
    content: "how much do decks usually run around here?",
    onEvent: () => {},
  });
  assertEquals(asked.filter((r) => r.stream).length, 1);
  await resetKv();
});

Deno.test("REQ-670: a question typed on Pick a price streams the model's answer too", async () => {
  const ctx = await setup();
  const ANSWER =
    "Labor only for the quartz — the slab material isn't in these prices.";
  answer(ctx.llm, () => ({ text: ANSWER }));
  await ctx.messages.append({
    conversationId: ctx.convId,
    role: "user",
    kind: "text",
    content: "Kitchen gut for the Hendersons: quartz top 48 sqft",
  });
  const events: ChatTurnEvent[] = [];
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: ctx.convId,
    content: "does this include the quartz slab material or just labor?",
    step: {
      id: "price",
      job: "Kitchen gut for the Hendersons: quartz top 48 sqft",
      tiers: true,
      options: [
        { label: "Competitive", priceCents: 1_700_000 },
        { label: "Market", priceCents: 2_000_000 },
        { label: "Premium", priceCents: 2_400_000 },
      ],
    },
    onEvent: (e) => events.push(e),
  });
  assert(events.filter((e) => e.type === "delta").length >= 3);
  assertEquals(shown(events), ANSWER);
  assertStringIncludes(replyOf(res.newMessages)?.content ?? "", ANSWER);
  await resetKv();
});
