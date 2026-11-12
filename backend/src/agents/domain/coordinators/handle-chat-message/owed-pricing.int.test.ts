/**
 * REQ-388 (demo-loop cycle 2, run r561db6d4: M19 + M23 + m38) —
 * HandleChatMessage answers "what does <customer> owe?" from that customer's
 * own quotes and invoices, answers a pricing question without drafting a
 * quote, and prices a follow-up with the same engine.
 *
 *   M19 (pair 2, Spanish): Ana López signed Q-001 ($400, "Pago al
 *   finalizar"); REQ-316 scheduled INV-001 for when the job wraps up and sent
 *   nothing. "¿Cuánto me debe Ana López?" in a new chat reached the chat
 *   model with no customer or invoice data, under a prompt that said "say the
 *   invoice already went out when they signed": it answered "El invoice ya se
 *   envió cuando firmó." — wrong, in English, with no amount.
 *
 *   M23 (pair 7): "what should i charge to move a shower drain 18 inches on a
 *   slab foundation in austin? explain how you got the number, and also
 *   cuánto cobro por piso radiante en un baño de 8x10?" became a DRAFT QUOTE
 *   whose line item was the whole question, at one Market price; the second
 *   question and the "explain" were dropped.
 *
 *   m38 (pair 7): "y para un baño de 5x8?" went to the free chat model, which
 *   priced it on its own and told the contractor to get quotes from other
 *   contractors.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { HandleChatMessage } from "./mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { StubLLMClient } from "@agents/domain/business/llm/implementations/stub/mod.ts";
import type { LLMRequest } from "@agents/domain/business/llm/base/mod.ts";
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
import { EventBus } from "@core/business/events/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";
import { ChangeOrderStore } from "@paperwork/domain/data/change-order-store/mod.ts";
import type { SendChangeOrderAlert } from "@paperwork/domain/coordinators/send-change-order-alert/mod.ts";
import { ApplyChatChangeOrder } from "@agents/domain/coordinators/apply-chat-change-order/mod.ts";
import { ReviseQuote } from "@agents/domain/coordinators/revise-quote/mod.ts";
import type { AgentMessage } from "@agents/dto/message.ts";
import { BuildCustomerCards } from "@analytics/domain/coordinators/build-customer-cards/mod.ts";
import { ViewStore } from "@paperwork/domain/data/view-store/mod.ts";

const PAIR2_ASK = "¿Cuánto me debe Ana López?";
const PAIR2_FOLLOW_UP =
  "No entiendo. ¿Cuánto dinero me debe y cuándo me va a pagar?";
const PAIR7_ASK =
  "what should i charge to move a shower drain 18 inches on a slab foundation in austin? explain how you got the number, and also cuánto cobro por piso radiante en un baño de 8x10?";

/** A contractor past the assistant's onboarding questions, in Austin. */
async function seedOnboarded(userId: string, language: "en" | "es" = "en") {
  const kv = await getKv();
  const now = new Date().toISOString();
  await kv.set(["user", userId], {
    id: userId,
    phoneNumber: "+15125550000",
    name: language === "es" ? "Jorge Ramirez" : "Priya Nair",
    email: "pro@test.dev",
    language,
    createdAt: now,
    updatedAt: now,
  });
  await new BusinessIdentityStore().upsert(userId, {
    businessName: "Pro LLC",
    acceptedPaymentMethods: {
      zelle: { enabled: true, handle: "pro@test.dev" },
    },
  });
  await new BusinessAddressStore().upsert(userId, {
    city: "Austin",
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
  const email = new EmailService();
  email.send = (_input: SendEmailInput) =>
    Promise.resolve({ ok: true, reason: "test_capture" });
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
  const changeOrder = new ApplyChatChangeOrder(
    quotes,
    invoices,
    new ChangeOrderStore(),
    customers,
    {
      run: () => Promise.resolve({ ok: true }),
    } as unknown as SendChangeOrderAlert,
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
    emailer,
    llm,
    changeOrder,
    new ReviseQuote(quotes, customers),
    undefined,
    customers,
  );
  return { conversations, messages, llm, quotes, invoices, customers, flow };
}

const TIERS_JSON = JSON.stringify({
  options: [
    { tier: "competitive", priceCents: 180_000, rationale: "Priced to win" },
    { tier: "market", priceCents: 240_000, rationale: "Typical here" },
    { tier: "premium", priceCents: 310_000, rationale: "Fast, permit pulled" },
  ],
});

/** Pricing calls (JSON mode) get tiers; chat-model calls are recorded and
 *  answered with `chatAnswer`. */
function scriptLlm(
  fx: ReturnType<typeof fresh>,
  chatAnswer: (req: LLMRequest) => string = () => "(chat model answer)",
) {
  const chat: LLMRequest[] = [];
  const pricing: LLMRequest[] = [];
  fx.llm.setHandler((req) => {
    if (req.responseFormat === "json") {
      pricing.push(req);
      return { text: TIERS_JSON };
    }
    chat.push(req);
    return { text: chatAnswer(req) };
  });
  return { chat, pricing };
}

const assistantText = (msgs: AgentMessage[]) =>
  msgs.filter((m) => m.role === "assistant" && m.kind === "text")
    .map((m) => m.content).join("\n");
const userContent = (req: LLMRequest) =>
  req.messages.filter((m) => m.role === "user").map((m) => m.content).join(
    "\n",
  );

/** Pair 2's books at 09:15: Ana signed Q-001 ($400, pay on completion);
 *  signing scheduled INV-001 for the end of the job and sent nothing. */
async function anaSignedPayOnCompletion(fx: ReturnType<typeof fresh>) {
  await seedOnboarded("u-1", "es");
  const ana = await fx.customers.create("u-1", {
    name: "Ana López",
    phoneNumber: "+15125550199",
  });
  const quote = await fx.quotes.create("u-1", {
    customerId: ana.id,
    summary: "Mantenimiento de jardín",
    jobName: "Mantenimiento de jardín",
    lineItems: [{
      description: "Mantenimiento de jardín, 4 semanas",
      quantity: 1,
      unit: "ea",
      price: 40_000,
    }],
    estimatedTotal: 40_000,
    terms: [{
      stepId: "payment_terms",
      label: "Payment terms",
      value: "Payment upon completion",
    }],
    status: "draft",
  });
  await fx.quotes.update(quote.id, "u-1", {
    status: "accepted",
    sentAt: "2026-11-12T09:11:00Z",
    acceptedAt: "2026-11-12T09:12:00Z",
    acceptedName: "Ana López",
  });
  const invoice = await fx.invoices.create("u-1", {
    quoteId: quote.id,
    customerId: ana.id,
    amount: 40_000,
    status: "scheduled",
    scheduledFor: "2026-11-26",
    dueDate: "2026-12-11",
    installmentIndex: 1,
    installmentTotal: 1,
  });
  return { ana, quote, invoice };
}

// ---------------------------------------------------------------------------
// M19
// ---------------------------------------------------------------------------

Deno.test("REQ-388 M19: pair 2 — '¿Cuánto me debe Ana López?' in a new chat answers from her quote and invoice, in Spanish: $400, INV-001 scheduled for Nov 26 — the chat model is never asked", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const fx = fresh();
  const { invoice } = await anaSignedPayOnCompletion(fx);
  const calls = scriptLlm(fx, () => "El invoice ya se envió cuando firmó.");
  const conv = await fx.conversations.create({ userId: "u-1" });

  const res = await fx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: PAIR2_ASK,
  });

  assertEquals(calls.chat.length, 0, "the chat model answered pair 2");
  const text = assistantText(res.newMessages);
  // REQ-474 (cycle 3, M17): a scheduled bill is not owed yet — the Clientes rule
  assertStringIncludes(
    text,
    "Ana López todavía no te debe nada — $400 aún no se ha facturado",
  );
  assertStringIncludes(text, invoice.number!);
  assertStringIncludes(text, "programada");
  assertStringIncludes(text, "26 nov");
  assert(!/invoice/i.test(text), `English 'invoice': ${text}`);
  assert(!/se envi[oó]/i.test(text), `claims it was sent: ${text}`);
  // an answer, nothing else: no card, no CTA, nothing billed or changed
  assertEquals(res.newMessages.filter((m) => m.kind !== "text").length, 0);
  assertEquals((await fx.invoices.listByUser("u-1")).length, 1);
  assertEquals(
    (await fx.invoices.getOwned(invoice.id, "u-1")).status,
    "scheduled",
  );
  assertEquals(res.conversation.quoteId, undefined);
  await resetKv();
});

Deno.test("REQ-388 M19: pair 2's follow-up 'No entiendo. ¿Cuánto dinero me debe y cuándo me va a pagar?' is about Ana — the amount and the dates, never a refusal", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const fx = fresh();
  await anaSignedPayOnCompletion(fx);
  const calls = scriptLlm(
    fx,
    () =>
      "El invoice ya se envió cuando firmó, así que no puedo darte detalles sobre el monto o la fecha de pago.",
  );
  const conv = await fx.conversations.create({ userId: "u-1" });
  await fx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: PAIR2_ASK,
  });

  const res = await fx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: PAIR2_FOLLOW_UP,
  });

  assertEquals(calls.chat.length, 0);
  const text = assistantText(res.newMessages);
  assertStringIncludes(
    text,
    "Ana López todavía no te debe nada — $400 aún no se ha facturado",
  ); // REQ-474
  assertStringIncludes(text, "26 nov"); // when it goes out
  assertStringIncludes(text, "11 dic"); // when it is due
  assert(!/no puedo/i.test(text), text);
  await resetKv();
});

Deno.test("REQ-388 M19: on Ana's own quote thread '¿Cuánto me debe?' needs no name; an unknown name says so; no name and nothing bound asks whose", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const fx = fresh();
  const { ana, quote } = await anaSignedPayOnCompletion(fx);
  const calls = scriptLlm(fx);

  const bound = await fx.conversations.create({
    userId: "u-1",
    quoteId: quote.id,
    customerId: ana.id,
    currentPhase: "terms",
  });
  const mine = await fx.flow.run({
    userId: "u-1",
    conversationId: bound.id,
    content: "¿cuánto me debe?",
  });
  assertStringIncludes(
    assistantText(mine.newMessages),
    "Ana López todavía no te debe nada — $400 aún no se ha facturado", // REQ-474
  );

  const blank = await fx.conversations.create({ userId: "u-1" });
  const nobody = await fx.flow.run({
    userId: "u-1",
    conversationId: blank.id,
    content: "¿Cuánto me debe Rosa Díaz?",
  });
  const said = assistantText(nobody.newMessages);
  assertStringIncludes(said, "Rosa Díaz");
  assertStringIncludes(said, "No encontré");

  const blank2 = await fx.conversations.create({ userId: "u-1" });
  const whose = await fx.flow.run({
    userId: "u-1",
    conversationId: blank2.id,
    content: "¿cuánto me debe?",
  });
  assertStringIncludes(assistantText(whose.newMessages), "¿De qué cliente?");
  assertEquals(calls.chat.length, 0);
  await resetKv();
});

Deno.test("REQ-388 M19: 'how much does John Miller owe me?' (pair 1's books) — the deposit invoice is out, the balance is scheduled: $3,200, in English", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const fx = fresh();
  await seedOnboarded("u-1");
  const calls = scriptLlm(fx);
  const john = await fx.customers.create("u-1", { name: "John Miller" });
  const quote = await fx.quotes.create("u-1", {
    customerId: john.id,
    summary: "Repaint",
    lineItems: [{
      description: "Repaint 3 bedrooms and hallway",
      quantity: 1,
      unit: "ea",
      price: 320_000,
    }],
    estimatedTotal: 320_000,
    status: "draft",
  });
  await fx.quotes.update(quote.id, "u-1", {
    status: "accepted",
    acceptedAt: "2026-11-12T05:35:18Z",
  });
  const deposit = await fx.invoices.create("u-1", {
    quoteId: quote.id,
    customerId: john.id,
    amount: 160_000,
    dueDate: "2099-11-19",
    issuedDate: "2026-11-12",
    status: "sent",
    installmentIndex: 1,
    installmentTotal: 2,
  });
  const balance = await fx.invoices.create("u-1", {
    quoteId: quote.id,
    customerId: john.id,
    amount: 160_000,
    dueDate: "2099-12-03",
    status: "scheduled",
    scheduledFor: "2099-11-26",
    installmentIndex: 2,
    installmentTotal: 2,
  });
  const conv = await fx.conversations.create({ userId: "u-1" });

  const res = await fx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "how much does John Miller owe me?",
  });

  assertEquals(calls.chat.length, 0);
  const text = assistantText(res.newMessages);
  // REQ-474: $1,600 out (owed now), $1,600 scheduled (not billed yet)
  assertStringIncludes(
    text,
    "John Miller owes you $1,600 now; $1,600 more isn't billed yet.",
  );
  assertStringIncludes(text, `$1,600 invoice (${deposit.number}) is out`);
  assertStringIncludes(text, "Nov 19");
  assertStringIncludes(text, balance.number!);
  assertStringIncludes(text, "Nov 26");
  await resetKv();
});

// ---------------------------------------------------------------------------
// M23
// ---------------------------------------------------------------------------

Deno.test("REQ-388 M23: pair 7's question in a new chat — each job priced on its own, the explanation written around those prices, and no quote drafted", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const fx = fresh();
  await seedOnboarded("u-1");
  const calls = scriptLlm(
    fx,
    () =>
      "Moving the drain: $2,400 typical — slab cut, trenching, re-pour. Heated floor 8x10: $2,400 typical — mat, thermostat, circuit.",
  );
  const conv = await fx.conversations.create({ userId: "u-1" });

  const res = await fx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: PAIR7_ASK,
  });

  // nothing drafted: no card, no quote, nothing bound
  assertEquals(
    res.newMessages.filter((m) => m.kind === "action_card").length,
    0,
    "a question became a draft quote",
  );
  assertEquals((await fx.quotes.listByUser("u-1")).length, 0);
  assertEquals(res.conversation.quoteId, undefined);

  // each job priced on its own words — never the whole message as one job
  assertEquals(calls.pricing.length, 2);
  const drain = userContent(calls.pricing[0]);
  assertStringIncludes(
    drain,
    "move a shower drain 18 inches on a slab foundation",
  );
  assert(!drain.includes("piso radiante"), drain);
  const floor = userContent(calls.pricing[1]);
  assertStringIncludes(floor, "piso radiante en un baño de 8x10");
  assert(!floor.includes("shower drain"), floor);

  // "explain how you got the number": the chat model writes it, from those
  // prices, with no tool it could draft with
  assertEquals(calls.chat.length, 1);
  assertEquals(calls.chat[0].tools, []);
  const context = calls.chat[0].businessContext ?? "";
  assertStringIncludes(
    context,
    "move a shower drain 18 inches on a slab foundation",
  );
  assertStringIncludes(context, "piso radiante en un baño de 8x10");
  assertStringIncludes(context, "$2,400");
  assertStringIncludes(
    assistantText(res.newMessages),
    "Heated floor 8x10: $2,400 typical",
  );
  await resetKv();
});

Deno.test("REQ-388 M23: a plain pricing question gets the tiers and a 'Draft a quote' offer — the quote is drafted only when the contractor asks", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const fx = fresh();
  await seedOnboarded("u-1");
  const calls = scriptLlm(fx);
  const conv = await fx.conversations.create({ userId: "u-1" });

  const asked = await fx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content:
      "what should i charge to move a shower drain 18 inches on a slab foundation in austin?",
  });
  assertEquals(calls.chat.length, 0);
  assertEquals(calls.pricing.length, 1);
  const text = assistantText(asked.newMessages);
  assertStringIncludes(
    text,
    "Here's what I'd charge to move a shower drain 18 inches on a slab foundation in Austin, TX:",
  );
  assertStringIncludes(text, "Market: $2,400");
  assertEquals(
    asked.newMessages.filter((m) => m.kind === "action_card").length,
    0,
  );
  assertEquals((await fx.quotes.listByUser("u-1")).length, 0);
  const reply = asked.newMessages.find((m) =>
    m.role === "assistant" && m.kind === "text"
  );
  assertEquals(reply?.payload?.draftOffer, {
    title: "Move a shower drain 18 inches on a slab foundation",
    amountCents: 240_000,
    tier: "Market",
  });

  // The offer's button sends its own words.
  const drafted = await fx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "Draft a quote at $2,400",
  });
  assertEquals(calls.chat.length, 0, "the draft went through the chat model");
  const card = drafted.newMessages.find((m) => m.kind === "action_card");
  assert(card, "no draft card");
  assertEquals((card!.payload as { totalCents?: number }).totalCents, 240_000);
  const quotes = await fx.quotes.listByUser("u-1");
  assertEquals(quotes.length, 1);
  assertEquals(
    quotes[0].lineItems[0].description,
    "Move a shower drain 18 inches on a slab foundation",
  );
  assertEquals(quotes[0].estimatedTotal, 240_000);
  assertEquals(drafted.conversation.quoteId, quotes[0].id);
  await resetKv();
});

Deno.test("REQ-388 M23: 'draft it at $3,100' after the tiers drafts at the price the contractor picked", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const fx = fresh();
  await seedOnboarded("u-1");
  scriptLlm(fx);
  const conv = await fx.conversations.create({ userId: "u-1" });
  await fx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "how much do i charge for panel swap 200a",
  });
  const drafted = await fx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "draft it at $3,100",
  });
  const quotes = await fx.quotes.listByUser("u-1");
  assertEquals(quotes.length, 1);
  assertEquals(quotes[0].estimatedTotal, 310_000);
  assertEquals(quotes[0].lineItems[0].description, "Panel swap 200a");
  assertEquals(drafted.conversation.quoteId, quotes[0].id);
  await resetKv();
});

// ---------------------------------------------------------------------------
// m38
// ---------------------------------------------------------------------------

Deno.test("REQ-388 m38: 'y para un baño de 5x8?' after the heated-floor price is priced by the pricing engine with the earlier tiers as context — not the chat model", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const fx = fresh();
  await seedOnboarded("u-1", "es");
  const calls = scriptLlm(fx);
  const conv = await fx.conversations.create({ userId: "u-1" });
  await fx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "¿cuánto cobro por piso radiante en un baño de 8x10?",
  });

  const res = await fx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "y para un baño de 5x8?",
  });

  assertEquals(calls.chat.length, 0, "the follow-up went to the chat model");
  assertEquals(calls.pricing.length, 2);
  const asked = userContent(calls.pricing[1]);
  assertStringIncludes(asked, "y para un baño de 5x8?");
  assertStringIncludes(asked, "piso radiante en un baño de 8x10");
  assertStringIncludes(asked, "$2,400");
  const text = assistantText(res.newMessages);
  assertStringIncludes(text, "un baño de 5x8");
  assertStringIncludes(text, "De mercado: $2,400");
  assertEquals((await fx.quotes.listByUser("u-1")).length, 0);
  // "un baño de 5x8" alone is no job to draft — a follow-up offers no draft
  const reply = res.newMessages.find((m) =>
    m.role === "assistant" && m.kind === "text"
  );
  assertEquals(reply?.payload?.draftOffer, undefined);
  assert(reply?.payload?.pricing, "the follow-up's prices are kept as context");
  await resetKv();
});

Deno.test("REQ-388 m38: what the chat model still answers after a price ('…en español por favor') carries the rule — advise the contractor, never send them to other contractors", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const fx = fresh();
  await seedOnboarded("u-1");
  const calls = scriptLlm(fx);
  const conv = await fx.conversations.create({ userId: "u-1" });
  await fx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "how much do i charge for panel swap 200a",
  });
  await fx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "no no thats not a quote, I was ASKING... en español por favor",
  });

  assertEquals(calls.chat.length, 1);
  assert(
    /never tell them to get quotes or bids from other contractors/i.test(
      calls.chat[0].systemPrompt,
    ),
    "no contractor-advice rule in the prompt",
  );
  await resetKv();
});

// ---------------------------------------------------------------------------
// REQ-474 (demo-loop cycle 3, M17)
// ---------------------------------------------------------------------------

Deno.test("REQ-474 M17: the demo's books — Ana Pérez's INV-001 $180 scheduled on Q-001 plus a direct INV-002 $180 sent — the assistant says $180 owed now and $180 not billed yet, the same $180 the Clientes card shows", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const fx = fresh();
  await seedOnboarded("u-1", "es");
  const calls = scriptLlm(fx);
  const ana = await fx.customers.create("u-1", { name: "Ana Pérez" });
  const quote = await fx.quotes.create("u-1", {
    customerId: ana.id,
    summary: "Limpieza profunda",
    lineItems: [{
      description: "Limpieza profunda",
      quantity: 1,
      unit: "ea",
      price: 18_000,
    }],
    estimatedTotal: 18_000,
    status: "draft",
  });
  await fx.quotes.update(quote.id, "u-1", {
    status: "accepted",
    acceptedAt: "2026-11-12T09:00:00Z",
  });
  await fx.invoices.create("u-1", {
    quoteId: quote.id,
    customerId: ana.id,
    amount: 18_000,
    status: "scheduled",
    scheduledFor: "2099-11-20",
    dueDate: "2099-11-20",
  });
  // the standalone "Bill a client directly" invoice: no quoteId
  await fx.invoices.create("u-1", {
    customerId: ana.id,
    amount: 18_000,
    status: "sent",
    issuedDate: "2026-11-12",
    dueDate: "2099-12-12",
  });
  const conv = await fx.conversations.create({ userId: "u-1" });

  const res = await fx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "¿Cuánto me debe Ana Pérez?",
  });

  assertEquals(calls.chat.length, 0);
  const text = assistantText(res.newMessages);
  assertStringIncludes(
    text,
    "Ana Pérez te debe $180 ahora; $180 más aún no se ha facturado.",
  );
  assert(!text.includes("$360"), text);

  const cards = await new BuildCustomerCards(
    fx.customers,
    fx.quotes,
    fx.invoices,
    new ViewStore(),
  ).run("u-1");
  const card = cards.find((c) => c.id === ana.id)!;
  assertEquals(card.balanceCents, 18_000, "the Clientes card: $180 owed");
  await resetKv();
});
