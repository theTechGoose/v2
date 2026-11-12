/**
 * REQ-368 (demo-loop cycle 1, M30 + M32) — HandleChatMessage answers a
 * pricing question with prices and a billing ask with the bill, from the
 * app's own data; and the chat model only gets the tools the conversation's
 * state allows.
 *
 *   M30 (pair 10): "how much do i charge for panel swap 200a" reached
 *   gpt-4o-mini with no pricing path, which answered "I can't provide pricing
 *   advice…" — though the composer's own example asks "what should I charge?".
 *
 *   M32 (pair 1): after John signed, "Please send him the deposit invoice"
 *   reached the terms-phase model with EVERY tool attached; it called
 *   lock_quote, the lock branch re-emitted the signed quote as an APPROVED
 *   card plus "Is this for a business or a person?", and that CTA ended in
 *   "All terms answered." — while the $1,600 deposit invoice had already gone
 *   out at signing.
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
import { wizardSpecFor } from "@agents/domain/business/terms-wizard-spec/mod.ts";
import type { AgentMessage } from "@agents/dto/message.ts";

/** A contractor past the assistant's onboarding questions, in Austin. */
async function seedOnboarded(userId: string, language: "en" | "es" = "en") {
  const kv = await getKv();
  const now = new Date().toISOString();
  await kv.set(["user", userId], {
    id: userId,
    phoneNumber: "+15125550000",
    name: "Pat Painter",
    email: "pat@test.dev",
    language,
    createdAt: now,
    updatedAt: now,
  });
  await new BusinessIdentityStore().upsert(userId, {
    businessName: "Pat LLC",
    acceptedPaymentMethods: { venmo: { enabled: true, handle: "@pat" } },
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
  const bus = new EventBus();
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
  const alert = {
    run: () => Promise.resolve({ ok: true }),
  } as unknown as SendChangeOrderAlert;
  const changeOrder = new ApplyChatChangeOrder(
    quotes,
    invoices,
    new ChangeOrderStore(),
    customers,
    alert,
  );
  const flow = new HandleChatMessage(
    conversations,
    messages,
    quotes,
    new FileStore(),
    users,
    identity,
    new BusinessAddressStore(),
    bus,
    emailer,
    llm,
    changeOrder,
    new ReviseQuote(quotes, customers), // REQ-315
  );
  return { conversations, messages, llm, quotes, invoices, flow };
}

const TIERS_JSON = JSON.stringify({
  options: [
    {
      tier: "competitive",
      priceCents: 180_000,
      rationale: "Straightforward swap",
    },
    {
      tier: "market",
      priceCents: 240_000,
      rationale: "Typical 200A swap here",
    },
    {
      tier: "premium",
      priceCents: 310_000,
      rationale: "Same-day, permit pulled",
    },
  ],
});

/** The pricing call (JSON mode) gets tiers; every chat-model call is
 *  recorded and answered with the demo's refusal / the demo's lock_quote. */
function scriptLlm(
  fx: ReturnType<typeof fresh>,
  chatAnswer: (req: LLMRequest) => {
    text: string;
    action?: { type: "lock_quote"; payload: { quoteId: string } } | {
      type: "request_terms_transition";
      payload: { quoteId: string };
    };
  } = () => ({
    text: "I can't provide pricing advice, but I can help you draft a quote.",
  }),
) {
  const chat: LLMRequest[] = [];
  const pricing: LLMRequest[] = [];
  fx.llm.setHandler((req) => {
    if (req.responseFormat === "json") {
      pricing.push(req);
      return { text: TIERS_JSON };
    }
    chat.push(req);
    return chatAnswer(req);
  });
  return { chat, pricing };
}

const assistantText = (msgs: AgentMessage[]) =>
  msgs.filter((m) => m.role === "assistant" && m.kind === "text")
    .map((m) => m.content).join("\n");

// ---------------------------------------------------------------------------
// M30
// ---------------------------------------------------------------------------

Deno.test("REQ-368 M30: the demo's pricing question gets three priced tiers and a draft at the Market price — the chat model is never asked", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const fx = fresh();
  await seedOnboarded("u-1");
  const calls = scriptLlm(fx);
  const conv = await fx.conversations.create({ userId: "u-1" });

  const res = await fx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "how much do i charge for panel swap 200a",
  });

  assertEquals(
    calls.chat.length,
    0,
    "the chat model answered a pricing question",
  );
  assertEquals(calls.pricing.length, 1);
  // SuggestPrices priced the contractor's own words, for their market
  const asked = calls.pricing[0].messages[0].content;
  assertStringIncludes(asked, "how much do i charge for panel swap 200a");
  assertStringIncludes(asked, "Austin, TX 78701");

  const text = assistantText(res.newMessages);
  assert(!/can'?t provide/i.test(text), text);
  assertStringIncludes(text, "Competitive: $1,800");
  assertStringIncludes(text, "Market: $2,400");
  assertStringIncludes(text, "Premium: $3,100");

  const card = res.newMessages.find((m) => m.kind === "action_card");
  assert(card, "no draft card");
  const p = card!.payload as {
    status?: string;
    quoteId?: string;
    totalCents?: number;
  };
  assertEquals(p.status, "draft");
  assertEquals(p.totalCents, 240_000);
  const quote = await fx.quotes.getOwned(p.quoteId!, "u-1");
  assertEquals(quote.estimatedTotal, 240_000);
  assertEquals(quote.lineItems[0].description, "Panel swap 200a");
  assertEquals(res.conversation.quoteId, quote.id);
  await resetKv();
});

Deno.test("REQ-368 M30: a Spanish contractor's '¿cuánto cobro…?' gets the tiers in Spanish", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const fx = fresh();
  await seedOnboarded("u-1", "es");
  const calls = scriptLlm(fx);
  const conv = await fx.conversations.create({ userId: "u-1" });

  const res = await fx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "¿Cuánto cobro por cambiar un panel de 200A?",
  });

  assertEquals(calls.chat.length, 0);
  const text = assistantText(res.newMessages);
  assertStringIncludes(text, "cambiar un panel de 200A");
  assertStringIncludes(text, "Competitivo: $1,800");
  assertStringIncludes(text, "De mercado: $2,400");
  await resetKv();
});

Deno.test("REQ-368 M30: with a draft open, 'what should I charge for this?' prices that draft and leaves its price alone", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const fx = fresh();
  await seedOnboarded("u-1");
  const calls = scriptLlm(fx);
  const draft = await fx.quotes.create("u-1", {
    summary: "Panel swap",
    jobName: "Panel swap",
    lineItems: [{
      description: "Panel swap 200A",
      quantity: 1,
      unit: "ea",
      price: 150_000,
    }],
    estimatedTotal: 150_000,
    status: "draft",
  });
  const conv = await fx.conversations.create({
    userId: "u-1",
    quoteId: draft.id,
  });

  const res = await fx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "what should I charge for this?",
  });

  assertEquals(calls.chat.length, 0);
  assertStringIncludes(calls.pricing[0].messages[0].content, "Panel swap 200A");
  const text = assistantText(res.newMessages);
  assertStringIncludes(text, "Market: $2,400");
  assertStringIncludes(text, "update the quote");
  assertEquals(
    res.newMessages.filter((m) => m.kind === "action_card").length,
    0,
  );
  assertEquals(
    (await fx.quotes.getOwned(draft.id, "u-1")).estimatedTotal,
    150_000,
  );
  await resetKv();
});

Deno.test("REQ-368 M30: a pricing question naming no job goes to the chat model, whose prompts (quote and terms) forbid refusing it", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const fx = fresh();
  await seedOnboarded("u-1");
  const calls = scriptLlm(fx, () => ({ text: "What's the job?" }));
  const conv = await fx.conversations.create({ userId: "u-1" });
  await fx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "what should I charge?",
  });
  assertEquals(calls.chat.length, 1);
  const quotePrompt = calls.chat[0].systemPrompt;
  assertStringIncludes(quotePrompt, "PRICING QUESTIONS");
  assert(
    /never refuse/i.test(quotePrompt),
    "no never-refuse rule in the quote prompt",
  );

  const terms = await fx.conversations.create({
    userId: "u-1",
    currentPhase: "terms",
  });
  await fx.flow.run({
    userId: "u-1",
    conversationId: terms.id,
    content: "is that a fair price for the job?",
  });
  assertEquals(calls.chat.length, 2);
  assertStringIncludes(calls.chat[1].systemPrompt, "PRICING QUESTIONS");
  await resetKv();
});

// ---------------------------------------------------------------------------
// M32
// ---------------------------------------------------------------------------

/** Pair 1's state at 05:35: the quote is signed, the conversation is in the
 *  terms phase with the wizard finished, and signing billed the deposit. */
async function signedWithDeposit(fx: ReturnType<typeof fresh>) {
  await seedOnboarded("u-1");
  const quote = await fx.quotes.create("u-1", {
    summary: "Repaint 3 Bedrooms and Hallway",
    jobName: "Repaint",
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
    lockedAt: "2026-11-12T05:30:00Z",
    sentAt: "2026-11-12T05:33:00Z",
    acceptedAt: "2026-11-12T05:35:18Z",
    acceptedName: "John Miller",
  });
  const deposit = await fx.invoices.create("u-1", {
    quoteId: quote.id,
    amount: 160_000,
    dueDate: "2026-11-19",
    issuedDate: "2026-11-12",
    status: "sent",
    installmentIndex: 1,
    installmentTotal: 2,
  });
  const balance = await fx.invoices.create("u-1", {
    quoteId: quote.id,
    amount: 160_000,
    dueDate: "2026-12-03",
    status: "scheduled",
    scheduledFor: "2026-11-26",
    installmentIndex: 2,
    installmentTotal: 2,
  });
  const conv = await fx.conversations.create({
    userId: "u-1",
    quoteId: quote.id,
    currentPhase: "terms",
  });
  const spec = wizardSpecFor("quote");
  await fx.conversations.putWizardState(conv.id, {
    specId: spec.id,
    activeStepIdx: spec.steps.length,
    answers: [],
  });
  return { quote, deposit, balance, conv };
}

function assertNoRelock(msgs: AgentMessage[]) {
  const quoteCards = msgs.filter((m) =>
    m.kind === "action_card" &&
    (m.payload as { actionType?: string } | undefined)?.actionType === "quote"
  );
  assertEquals(
    quoteCards.length,
    0,
    "the signed quote was re-emitted as a card",
  );
  const termsCtas = msgs.filter((m) =>
    m.kind === "continue_cta" &&
    (m.payload as { toPhase?: string } | undefined)?.toPhase === "terms"
  );
  assertEquals(
    termsCtas.length,
    0,
    "'Is this for a business or a person?' again",
  );
}

Deno.test("REQ-368 M32: pair 1 — 'Please send him the deposit invoice' answers with the deposit invoice signing already sent, and never re-locks the signed quote", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const fx = fresh();
  const { quote, deposit, conv } = await signedWithDeposit(fx);
  // What the demo's model did with this sentence.
  const calls = scriptLlm(fx, () => ({
    text: "",
    action: { type: "lock_quote", payload: { quoteId: quote.id } },
  }));

  const res = await fx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "John signed! Please send him the deposit invoice for $1,600",
  });

  assertEquals(calls.chat.length, 0, "a billing ask reached the chat model");
  assertNoRelock(res.newMessages);
  const text = assistantText(res.newMessages);
  assertStringIncludes(text, deposit.number!);
  assertStringIncludes(text, "$1,600");
  assertStringIncludes(text, "deposit");
  const card = res.newMessages.find((m) => m.kind === "action_card");
  const p = card?.payload as {
    actionType?: string;
    invoiceId?: string;
    totalCents?: number;
  } | undefined;
  assertEquals(p?.actionType, "invoice");
  assertEquals(p?.invoiceId, deposit.id);
  assertEquals(p?.totalCents, 160_000);
  // nothing new was billed, and the chat now knows its invoice
  assertEquals((await fx.invoices.listByUser("u-1")).length, 2);
  assertEquals(res.conversation.invoiceId, deposit.id);
  assertEquals((await fx.quotes.getOwned(quote.id, "u-1")).status, "accepted");
  await resetKv();
});

Deno.test("REQ-368 M32: if the model still calls lock_quote on the signed quote, nothing is re-locked — the reply says where the bill stands", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const fx = fresh();
  const { quote, deposit, conv } = await signedWithDeposit(fx);
  const calls = scriptLlm(fx, () => ({
    text: "Locked.",
    action: { type: "lock_quote", payload: { quoteId: quote.id } },
  }));

  const res = await fx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "John signed!",
  });

  assertEquals(calls.chat.length, 1);
  assertNoRelock(res.newMessages);
  const text = assistantText(res.newMessages);
  assert(!text.includes("Locked."), "claimed a lock that did not happen");
  assertStringIncludes(text, deposit.number!);
  await resetKv();
});

Deno.test("REQ-368 M32: the chat model only gets the tools the state allows", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const fx = fresh();
  const { conv: signed } = await signedWithDeposit(fx);
  const calls = scriptLlm(fx, () => ({ text: "ok" }));

  // pair 1: terms phase, signed quote → no create / lock / terms tools
  await fx.flow.run({
    userId: "u-1",
    conversationId: signed.id,
    content: "John signed!",
  });
  const termsTools = calls.chat[0].tools;
  assert(termsTools, "every tool rode along (no allowlist)");
  for (
    const name of ["lock_quote", "request_terms_transition", "create_quote"]
  ) {
    assert(!termsTools!.includes(name as never), `${name} offered in terms`);
  }
  assert(termsTools!.includes("update_job_details"));

  // quote phase with a draft → it can be locked and taken to terms
  const draft = await fx.quotes.create("u-1", {
    summary: "Gutter cleaning",
    lineItems: [{
      description: "Gutter cleaning",
      quantity: 1,
      unit: "ea",
      price: 22_000,
    }],
    status: "draft",
  });
  const drafting = await fx.conversations.create({
    userId: "u-1",
    quoteId: draft.id,
  });
  await fx.flow.run({
    userId: "u-1",
    conversationId: drafting.id,
    content: "add the downspouts too",
  });
  assert(calls.chat[1].tools!.includes("lock_quote"));
  assert(calls.chat[1].tools!.includes("request_terms_transition"));

  // quote phase, nothing drafted yet → nothing to lock
  const blank = await fx.conversations.create({ userId: "u-1" });
  await fx.flow.run({
    userId: "u-1",
    conversationId: blank.id,
    content: "hello there",
  });
  assert(calls.chat[2].tools!.includes("create_quote"));
  assert(!calls.chat[2].tools!.includes("lock_quote"));
  await resetKv();
});

Deno.test("REQ-368 M32: a billing ask on a sent, unsigned quote says it bills on signing — nothing is billed", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const fx = fresh();
  await seedOnboarded("u-1");
  const calls = scriptLlm(fx);
  const quote = await fx.quotes.create("u-1", {
    summary: "Repaint",
    lineItems: [{
      description: "Repaint",
      quantity: 1,
      unit: "ea",
      price: 320_000,
    }],
    estimatedTotal: 320_000,
    status: "sent",
  });
  const conv = await fx.conversations.create({
    userId: "u-1",
    quoteId: quote.id,
    currentPhase: "terms",
  });

  const res = await fx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "send him the invoice",
  });

  assertEquals(calls.chat.length, 0);
  assertStringIncludes(assistantText(res.newMessages), "hasn't signed");
  assertEquals(res.newMessages.filter((m) => m.kind !== "text").length, 0);
  assertEquals((await fx.invoices.listByUser("u-1")).length, 0);
  await resetKv();
});

Deno.test("REQ-368 M32: signed with nothing billed yet → the 'Continue to invoice' CTA; the chat itself bills nothing", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const fx = fresh();
  await seedOnboarded("u-1");
  scriptLlm(fx);
  const quote = await fx.quotes.create("u-1", {
    summary: "Repaint",
    lineItems: [{
      description: "Repaint",
      quantity: 1,
      unit: "ea",
      price: 320_000,
    }],
    estimatedTotal: 320_000,
    status: "accepted",
  });
  const conv = await fx.conversations.create({
    userId: "u-1",
    quoteId: quote.id,
    currentPhase: "terms",
  });

  const res = await fx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "send the invoice",
  });

  const cta = res.newMessages.find((m) => m.kind === "continue_cta");
  assertEquals(
    (cta?.payload as { toPhase?: string } | undefined)?.toPhase,
    "invoice",
  );
  assertEquals((await fx.invoices.listByUser("u-1")).length, 0);
  await resetKv();
});

Deno.test("REQ-368 M32: request_terms_transition mid-wizard re-shows the current question — never 'Is this for a business or a person?'", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const fx = fresh();
  await seedOnboarded("u-1");
  const quote = await fx.quotes.create("u-1", {
    summary: "Repaint",
    lineItems: [{
      description: "Repaint",
      quantity: 1,
      unit: "ea",
      price: 320_000,
    }],
    status: "draft",
  });
  await fx.quotes.update(quote.id, "u-1", { lockedAt: "2026-11-12T05:30:00Z" });
  const conv = await fx.conversations.create({
    userId: "u-1",
    quoteId: quote.id,
    currentPhase: "terms",
  });
  const spec = wizardSpecFor("quote");
  await fx.conversations.putWizardState(conv.id, {
    specId: spec.id,
    activeStepIdx: 2,
    answers: [],
  });
  scriptLlm(fx, () => ({
    text: "Want to wrap the agreement terms now?",
    action: {
      type: "request_terms_transition",
      payload: { quoteId: quote.id },
    },
  }));

  const res = await fx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "next step",
  });

  assertNoRelock(res.newMessages);
  const step = res.newMessages.find((m) => m.kind === "wizard");
  assertEquals((step?.payload as { stepIdx?: number } | undefined)?.stepIdx, 2);
  await resetKv();
});

Deno.test("REQ-368 M32: on the next turn the chat model reads the invoice card as the invoice — never as '[Quote sent: … $1,600]'", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const fx = fresh();
  const { conv } = await signedWithDeposit(fx);
  const calls = scriptLlm(fx, () => ({ text: "You're all set." }));

  await fx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "John signed! Please send him the deposit invoice for $1,600",
  });
  await fx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "Thanks! What's next?",
  });

  assertEquals(calls.chat.length, 1);
  const turns = calls.chat[0].messages.map((m) => m.content);
  const card = turns.find((c) => c.includes("Deposit (1 of 2)"));
  assert(card, `the invoice card is missing from the model's turns`);
  assert(
    card!.startsWith("[Invoice sent:"),
    `the invoice card reached the model as: ${card}`,
  );
  assertEquals(turns.filter((c) => c.startsWith("[Quote")).length, 0);
  await resetKv();
});
