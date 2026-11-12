/**
 * REQ-445 (demo-loop cycle 3, B2 + M20) — the chat's create_quote is checked
 * against the price the contractor stated and against the size of the job
 * before it is saved.
 *
 * B2 (pair 7): on the $2,585 master-bath draft, "…$2,585 for a whole master
 * bath?? … make it around $18,000 and add the shower bench and mold
 * remediation allowance" was answered by gpt-4o-mini with the shower line at
 * $18,000, every other line ×10 and a $30,000 mold allowance — and the
 * coordinator saved $71,050 as it came.
 * M20 (pair 7): the first message ended "Precio? tú dime, yo pienso como 18
 * mil" and was drafted at $2,585 — the stated price and the bathroom-remodel
 * floor were both ignored.
 *
 * The stub LLM replays the demo model's own answers; the coordinator is real.
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
import { plausibilityFloorCents } from "@agents/domain/business/price-floor/mod.ts";
import type { AgentMessage } from "@agents/dto/message.ts";

/** The demo's correction (fleet-6 l.135). */
const DEMO_FIX =
  "no no eso está muy bajo!! $2,585 for a whole master bath?? make it around $18,000 and add the shower bench and mold remediation allowance";
/** The demo's all-Spanish job, typed straight into a new chat (fleet-6
 *  l.136/220), without and with the price she had in mind. */
const JOB_ES =
  "Remodelación del baño principal para la señora Okafor: quitar la tina, ducha walk-in de 60 pulgadas con vidrio frameless y una banca, " +
  "piso de azulejo 55 pies cuadrados, azulejo en las paredes de la ducha 90 pies cuadrados, instalar doble lavabo, extractor nuevo, " +
  "mover el contacto GFCI, pintar y reparar el drywall, puede haber moho detrás de la tina. Empezamos después de Año Nuevo.";
const DEMO_JOB_ES = `${JOB_ES} Precio? tú dime, yo pienso como 18 mil`;

type Line = { description: string; amountCents: number };
const SUMMARY = "Main bathroom remodel — Okafor";
/** The demo's first draft — TOTAL $2,585.00 (fleet-6 l.220). */
const FIRST_DRAFT: Line[] = [
  { description: "Tub removal", amountCents: 20_000 },
  {
    description: "Install walk-in shower with frameless glass",
    amountCents: 60_000,
  },
  { description: "Floor tile (55 sqft)", amountCents: 16_500 },
  { description: "Wall tile (90 sqft)", amountCents: 27_000 },
  { description: "Double vanity install", amountCents: 50_000 },
  { description: "Exhaust fan install", amountCents: 25_000 },
  { description: "Move GFCI outlet", amountCents: 10_000 },
  { description: "Interior painting", amountCents: 30_000 },
  { description: "Drywall repair", amountCents: 20_000 },
];
const BENCH = {
  description: "Shower bench installation",
  amountCents: 500_000,
};
const MOLD = {
  description: "Mold remediation allowance",
  amountCents: 3_000_000,
};
/** The demo model's answer to DEMO_FIX — $71,050 (fleet-6 l.222). */
const DEMO_X10: Line[] = [
  { description: "Tub removal", amountCents: 200_000 },
  {
    description: "Install walk-in shower with frameless glass",
    amountCents: 1_800_000,
  },
  { description: "Floor tile (55 sqft)", amountCents: 165_000 },
  { description: "Wall tile (90 sqft)", amountCents: 270_000 },
  { description: "Double vanity install", amountCents: 500_000 },
  { description: "Exhaust fan install", amountCents: 250_000 },
  { description: "Move GFCI outlet", amountCents: 100_000 },
  { description: "Interior painting", amountCents: 300_000 },
  { description: "Drywall repair", amountCents: 20_000 },
  BENCH,
  MOLD,
];
/** A model that heard the stated total: $18,200 over the same work. */
const NEAR_18K: Line[] = [
  { description: "Tub removal", amountCents: 80_000 },
  {
    description: "Install walk-in shower with frameless glass",
    amountCents: 830_000,
  },
  { description: "Floor tile (55 sqft)", amountCents: 110_000 },
  { description: "Wall tile (90 sqft)", amountCents: 180_000 },
  { description: "Double vanity install", amountCents: 150_000 },
  { description: "Exhaust fan install", amountCents: 45_000 },
  { description: "Move GFCI outlet", amountCents: 25_000 },
  { description: "Interior painting", amountCents: 70_000 },
  { description: "Drywall repair", amountCents: 60_000 },
  { description: "Shower bench installation", amountCents: 120_000 },
  { description: "Mold remediation allowance", amountCents: 150_000 },
];

const sum = (ls: readonly Line[]) => ls.reduce((s, l) => s + l.amountCents, 0);
const draftCall = (lineItems: Line[], text = ""): LLMResponse => ({
  text,
  action: { type: "create_quote", payload: { summary: SUMMARY, lineItems } },
});

async function seedOnboarded(userId: string) {
  const kv = await getKv();
  const now = new Date().toISOString();
  await kv.set(["user", userId], {
    id: userId,
    phoneNumber: "+15125550106",
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

async function fresh() {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  await seedOnboarded("u-1");
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
    new ApplyChatChangeOrder(
      quotes,
      invoices,
      new ChangeOrderStore(),
      customers,
      alert,
    ),
    new ReviseQuote(quotes, customers),
    undefined,
    customers,
  );
  return { conversations, messages, llm, quotes, flow };
}

/** Answer the model's calls in order (the last answer repeats) and keep
 *  every request it was sent. */
function script(llm: StubLLMClient, answers: LLMResponse[]): LLMRequest[] {
  const seen: LLMRequest[] = [];
  llm.setHandler((req) => {
    seen.push(req);
    return answers[Math.min(seen.length - 1, answers.length - 1)];
  });
  return seen;
}

/** The $2,585 draft bound to a conversation, as the demo had it. */
async function demoDraft(ctx: Awaited<ReturnType<typeof fresh>>) {
  const draft = await ctx.quotes.create("u-1", {
    summary: SUMMARY,
    lineItems: FIRST_DRAFT.map((l) => ({
      description: l.description,
      quantity: 1,
      unit: "ea",
      price: l.amountCents,
    })),
    estimatedTotal: sum(FIRST_DRAFT),
    status: "draft",
  });
  const conv = await ctx.conversations.create({
    userId: "u-1",
    quoteId: draft.id,
  });
  return { draft, conv };
}

const replyOf = (msgs: AgentMessage[]) =>
  msgs.find((m) => m.role === "assistant" && m.kind === "text")?.content ??
    "";
const cardOf = (msgs: AgentMessage[]) =>
  msgs.find((m) => m.kind === "action_card");
const storedTotal = (
  q: { lineItems: { price: number; quantity?: number }[] },
) => q.lineItems.reduce((s, l) => s + l.price * (l.quantity ?? 1), 0);

// ---------------------------------------------------------------------------
// B2 — a stated total on the open draft
// ---------------------------------------------------------------------------

Deno.test("REQ-445 B2: the demo's 'make it around $18,000…' on the $2,585 draft is saved at $18,000 — never the model's ×10 $71,050", async () => {
  const ctx = await fresh();
  const { draft, conv } = await demoDraft(ctx);
  // the model gives the demo's answer, and gives it again when re-asked
  const seen = script(ctx.llm, [draftCall(DEMO_X10, "Updated — $71,050.")]);
  const result = await ctx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: DEMO_FIX,
  });

  const stored = await ctx.quotes.getOwned(draft.id, "u-1");
  assertEquals(stored.estimatedTotal, 1_800_000);
  assertEquals(storedTotal(stored), 1_800_000);
  // the bench and the mold allowance she asked for are on it…
  assertEquals(
    stored.lineItems.map((l) => l.description),
    DEMO_X10.map((l) => l.description),
  );
  // …and no line carries the whole job's price
  for (const l of stored.lineItems) {
    assert(l.price > 0 && l.price < 1_800_000, `${l.description} ${l.price}`);
  }
  // the stated total reached the model, and the model was asked once more
  assertEquals(seen.length, 2);
  assertStringIncludes(seen[0].businessContext ?? "", "$18,000");
  const note = seen[1].messages[seen[1].messages.length - 1].content;
  assertStringIncludes(note, "$71,050");
  assertStringIncludes(note, "$18,000");
  // the reply and the card tell the saved total, not the model's
  const reply = replyOf(result.newMessages);
  assertStringIncludes(reply, "Total $2,585 → $18,000");
  assert(!reply.includes("71,050"), reply);
  const card = cardOf(result.newMessages)!;
  assertEquals((card.payload as { totalCents: number }).totalCents, 1_800_000);
  await resetKv();
});

Deno.test("REQ-445 B2: when the re-ask comes back near the stated total, the model's own split is saved as written", async () => {
  const ctx = await fresh();
  const { draft, conv } = await demoDraft(ctx);
  const seen = script(ctx.llm, [draftCall(DEMO_X10), draftCall(NEAR_18K)]);
  await ctx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: DEMO_FIX,
  });
  const stored = await ctx.quotes.getOwned(draft.id, "u-1");
  assertEquals(seen.length, 2);
  assertEquals(stored.estimatedTotal, sum(NEAR_18K));
  assertEquals(
    stored.lineItems.map((l) => l.price),
    NEAR_18K.map((l) => l.amountCents),
  );
  await resetKv();
});

Deno.test("REQ-445 B2: a model that honours the stated total the first time is saved with no second call", async () => {
  const ctx = await fresh();
  const { draft, conv } = await demoDraft(ctx);
  const seen = script(ctx.llm, [draftCall(NEAR_18K)]);
  await ctx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: DEMO_FIX,
  });
  assertEquals(seen.length, 1);
  assertEquals(
    (await ctx.quotes.getOwned(draft.id, "u-1")).estimatedTotal,
    sum(NEAR_18K),
  );
  await resetKv();
});

// ---------------------------------------------------------------------------
// B2 — the sanity gate on a revision with no stated total
// ---------------------------------------------------------------------------

Deno.test("REQ-445 B2: a revision that more than triples the total with prices nobody typed is asked about — the draft keeps $2,585, no card", async () => {
  const ctx = await fresh();
  const { draft, conv } = await demoDraft(ctx);
  const seen = script(ctx.llm, [
    draftCall([...FIRST_DRAFT, BENCH, MOLD], "Added both."),
  ]);
  const result = await ctx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "add the shower bench and mold remediation allowance",
  });
  const kept = await ctx.quotes.getOwned(draft.id, "u-1");
  assertEquals(kept.estimatedTotal, 258_500);
  assertEquals(kept.lineItems.length, FIRST_DRAFT.length);
  assertEquals(cardOf(result.newMessages), undefined);
  assertEquals(seen.length, 1);
  const reply = replyOf(result.newMessages);
  assertStringIncludes(reply, "$2,585");
  assertStringIncludes(reply, "$37,585");
  assertStringIncludes(reply, "Mold remediation allowance ($30,000)");
  assertStringIncludes(reply, "Shower bench installation ($5,000)");
  assert(!reply.includes("Added both"), reply);
  await resetKv();
});

Deno.test("REQ-445 B2: a big addition the contractor priced passes the gate and is saved", async () => {
  const ctx = await fresh();
  const { draft, conv } = await demoDraft(ctx);
  script(ctx.llm, [draftCall([...FIRST_DRAFT, MOLD])]);
  await ctx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "add a mold remediation allowance, $30,000",
  });
  assertEquals(
    (await ctx.quotes.getOwned(draft.id, "u-1")).estimatedTotal,
    258_500 + 3_000_000,
  );
  await resetKv();
});

// ---------------------------------------------------------------------------
// M20 — the first draft
// ---------------------------------------------------------------------------

Deno.test("REQ-445 M20: the demo's Spanish job ending 'yo pienso como 18 mil' is drafted at $18,000 — the stated price reaches the model and the draft", async () => {
  const ctx = await fresh();
  const conv = await ctx.conversations.create({ userId: "u-1" });
  // the demo's $2,585 draft, given twice
  const seen = script(ctx.llm, [draftCall(FIRST_DRAFT)]);
  const result = await ctx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: DEMO_JOB_ES,
  });
  assertStringIncludes(seen[0].businessContext ?? "", "$18,000");
  const quoteId = result.conversation.quoteId!;
  const stored = await ctx.quotes.getOwned(quoteId, "u-1");
  assertEquals(stored.estimatedTotal, 1_800_000);
  assertEquals(storedTotal(stored), 1_800_000);
  const card = cardOf(result.newMessages)!;
  assertEquals((card.payload as { totalCents: number }).totalCents, 1_800_000);
  await resetKv();
});

Deno.test("REQ-445 M20: with no price stated, a bathroom-remodel draft under the floor is re-asked once naming the job size; a model that stays low is lifted to the floor", async () => {
  const ctx = await fresh();
  const conv = await ctx.conversations.create({ userId: "u-1" });
  const seen = script(ctx.llm, [draftCall(FIRST_DRAFT)]);
  const result = await ctx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: JOB_ES,
  });
  assertEquals(seen.length, 2);
  const note = seen[1].messages[seen[1].messages.length - 1].content;
  assertStringIncludes(note, "$2,585");
  assertStringIncludes(note, "bathroom");
  const floor = plausibilityFloorCents(JOB_ES);
  assert(floor > 3 * 258_500, `floor ${floor} is far above the demo's $2,585`);
  const stored = await ctx.quotes.getOwned(result.conversation.quoteId!, "u-1");
  assert(
    stored.estimatedTotal! >= floor,
    `saved ${stored.estimatedTotal} under the floor ${floor}`,
  );
  assertEquals(storedTotal(stored), stored.estimatedTotal);
  await resetKv();
});

Deno.test("REQ-445 M20: a re-ask that comes back over the floor is saved as the model wrote it", async () => {
  const ctx = await fresh();
  const conv = await ctx.conversations.create({ userId: "u-1" });
  script(ctx.llm, [draftCall(FIRST_DRAFT), draftCall(NEAR_18K)]);
  const result = await ctx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: JOB_ES,
  });
  const stored = await ctx.quotes.getOwned(result.conversation.quoteId!, "u-1");
  assertEquals(stored.estimatedTotal, sum(NEAR_18K));
  await resetKv();
});

Deno.test("REQ-445: a small job has no floor — one model call, its price saved", async () => {
  const ctx = await fresh();
  const conv = await ctx.conversations.create({ userId: "u-1" });
  const seen = script(ctx.llm, [{
    text: "",
    action: {
      type: "create_quote",
      payload: {
        summary: "Kitchen faucet replacement",
        lineItems: [{
          description:
            "Kitchen faucet replacement (faucet supplied by customer)",
          amountCents: 25_000,
        }],
      },
    },
  }]);
  const result = await ctx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "replace the kitchen faucet, customer bought it",
  });
  assertEquals(seen.length, 1);
  assertEquals(
    (await ctx.quotes.getOwned(result.conversation.quoteId!, "u-1"))
      .estimatedTotal,
    25_000,
  );
  await resetKv();
});

Deno.test("REQ-445 B2: the quote-phase prompt says a price for the whole job is the total — spread over every line, never one line, never multiplied", async () => {
  const ctx = await fresh();
  const { conv } = await demoDraft(ctx);
  const seen = script(ctx.llm, [draftCall(NEAR_18K)]);
  await ctx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: DEMO_FIX,
  });
  const prompt = seen[0].systemPrompt;
  assertStringIncludes(prompt, "STATED TOTAL");
  assertStringIncludes(prompt, "yo pienso como 18 mil");
  assertStringIncludes(prompt, "never multiply the other lines");
  await resetKv();
});

Deno.test("REQ-445: a first draft at the contractor's own typed prices is saved as typed — the floor never lifts it, no second call", async () => {
  const ctx = await fresh();
  const conv = await ctx.conversations.create({ userId: "u-1" });
  const lines = [
    { description: "Demo cabinets", amountCents: 120_000 },
    { description: "Shaker cabinets installed", amountCents: 650_000 },
    { description: "Quartz", amountCents: 380_000 },
    { description: "Electrical", amountCents: 60_000 },
  ];
  const seen = script(ctx.llm, [{
    text: "Drafting a quote.",
    action: {
      type: "create_quote",
      payload: { summary: "Kitchen remodel — Henderson", lineItems: lines },
    },
  }]);
  const result = await ctx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content:
      "Kitchen remodel for the Hendersons. Demo cabinets $1,200, shaker cabinets installed $6,500, quartz $3,800, electrical $600.",
  });
  assertEquals(seen.length, 1);
  assertEquals(
    (await ctx.quotes.getOwned(result.conversation.quoteId!, "u-1"))
      .estimatedTotal,
    1_210_000,
  );
  await resetKv();
});
