/**
 * REQ-942 (LOOP-007 cycle 1, q1-1) — two alternatives the contractor typed
 * are never added into one total the customer signs.
 *
 * QA2 typed (to a new chat): "… two options: option A basic subway tile
 * $9,800, option B large format porcelain + niche + glass door $13,450 …".
 * The model answered create_quote with the two options as two lines; nothing
 * in the coordinator recognised them as alternatives (statedTotalCents is
 * undefined for this message), so ONE draft was saved at $23,250 — the sum of
 * two mutually exclusive jobs. The /q page, the email, the deposit and INV-001
 * all read that total, and signing bound the customer to both.
 *
 * The stub LLM replays that answer; the coordinator and stores are real.
 * Accepted fixes: draft option A alone (and say so), one draft per option, or
 * a quote that carries the options apart — never one quote summing both.
 */
import { assert } from "#std/assert";
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
import type { AgentMessage } from "@agents/dto/message.ts";

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

/** The tester's exact message (LOOP-007 QA2). */
const TWO_OPTIONS =
  "quote for Linda Park, guest bath remodel, tile floor 60 sqft and tile walls. two options: option A basic subway tile $9,800, option B large format porcelain + niche + glass door $13,450. 30% deposit up front, rest when done.";
const SUMMARY = "Guest bath remodel — Linda Park";
type Line = { description: string; amountCents: number };
/** What the model sent: each option as one line of the same quote. */
const OPTION_A: Line = {
  description:
    "Option A: guest bath tile floor (60 sqft) and walls, basic subway tile",
  amountCents: 980_000,
};
const OPTION_B: Line = {
  description:
    "Option B: large format porcelain tile floor and walls, niche, glass door",
  amountCents: 1_345_000,
};
const SUMMED = OPTION_A.amountCents + OPTION_B.amountCents; // 2,325,000

const draftCall = (lineItems: Line[], text = ""): LLMResponse => ({
  text,
  action: { type: "create_quote", payload: { summary: SUMMARY, lineItems } },
});

/** Answer every model call with the same response. */
function always(llm: StubLLMClient, answer: LLMResponse): LLMRequest[] {
  const seen: LLMRequest[] = [];
  llm.setHandler((req) => {
    seen.push(req);
    return answer;
  });
  return seen;
}

const totalOf = (
  q: { lineItems: { price: number; quantity?: number }[] },
) => q.lineItems.reduce((s, l) => s + l.price * (l.quantity ?? 1), 0);
const textOf = (msgs: AgentMessage[]) =>
  msgs.map((m) =>
    [m.content ?? "", m.payload ? JSON.stringify(m.payload) : ""].join(" ")
  ).join("\n");

Deno.test("REQ-942 (LOOP-007 q1-1): 'two options: option A … $9,800, option B … $13,450' is never saved as one $23,250 quote", async () => {
  const ctx = await fresh();
  always(ctx.llm, draftCall([OPTION_A, OPTION_B], "Drafting a quote."));
  const conv = await ctx.conversations.create({ userId: "u-1" });
  const result = await ctx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: TWO_OPTIONS,
  });

  const saved = await ctx.quotes.listByUser("u-1");
  for (const q of saved) {
    const total = typeof q.estimatedTotal === "number"
      ? q.estimatedTotal
      : totalOf(q);
    assert(
      total !== SUMMED && totalOf(q) !== SUMMED,
      `a saved quote totals $23,250 — option A + option B added together (estimatedTotal ${q.estimatedTotal}, lines ${
        JSON.stringify(q.lineItems.map((l) => [l.description, l.price]))
      })`,
    );
  }
  // the reply and the card never name the summed total
  const shown = textOf(result.newMessages);
  assert(!shown.includes("23,250"), `the reply names $23,250: ${shown}`);
  assert(!shown.includes(String(SUMMED)), `the card totals 2325000: ${shown}`);
  await resetKv();
});

Deno.test("REQ-942 (LOOP-007 q1-1): the Spanish 'dos opciones: opción A … $9,800, opción B … $13,450' is never saved as one $23,250 quote", async () => {
  const ctx = await fresh();
  always(ctx.llm, draftCall([OPTION_A, OPTION_B], "Preparando la cotización."));
  const conv = await ctx.conversations.create({ userId: "u-1" });
  await ctx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content:
      "cotización para Linda Park, remodelación del baño de visitas, piso de azulejo 60 pies cuadrados y paredes. dos opciones: opción A azulejo subway básico $9,800, opción B porcelanato de formato grande + nicho + puerta de vidrio $13,450. 30% de depósito, el resto al terminar.",
  });
  for (const q of await ctx.quotes.listByUser("u-1")) {
    assert(
      q.estimatedTotal !== SUMMED && totalOf(q) !== SUMMED,
      `a saved quote totals $23,250 — opción A + opción B added together (estimatedTotal ${q.estimatedTotal})`,
    );
  }
  await resetKv();
});

/**
 * REQ-1019 (LOOP-007 cycle 2, q2-2) — the tester typed "2 options: basic
 * porcelain tile $8,400 or upgrade with niche + glass door $11,200". The real
 * model drafted the base line AND the upgrade line at $8,400 plus three $0
 * lines; REQ-942's narrowing missed that shape and Q-001 was saved at
 * $16,800 — a total equal to neither option. "total should not be 16,800"
 * then re-saved the same lines: the correction turn has no options guard.
 */
const Q22 =
  "quote for maria gonzalez 843-555-0142 maria.g@example.com, 1418 oak hollow dr austin tx 78745. master bath redo, tear out old tub put in walk in shower w/ tile surround about 60 sqft wall tile + 35 sqft floor, new 48in vanity, 2 options: basic porcelain tile $8,400 or upgrade with niche + glass door $11,200. 30% deposit";
const Q22_LINES: Line[] = [
  { description: "Tear out old tub", amountCents: 0 },
  {
    description:
      "Install walk-in shower with tile surround (60 sqft wall, 35 sqft floor) - basic porcelain tile",
    amountCents: 840_000,
  },
  { description: "Install new 48in vanity", amountCents: 0 },
  { description: "Upgrade: tile niche and glass door", amountCents: 840_000 },
  { description: "Cleanup", amountCents: 0 },
];
const Q22_DOUBLED = 1_680_000;
const q22Draft = (text = ""): LLMResponse => ({
  text,
  action: {
    type: "create_quote",
    payload: { summary: "Master bath redo — Maria Gonzalez", lineItems: Q22_LINES },
  },
});
const totalSaved = (q: {
  estimatedTotal?: number;
  lineItems: { price: number; quantity?: number }[];
}) => typeof q.estimatedTotal === "number" ? q.estimatedTotal : totalOf(q);

Deno.test("REQ-1019 (LOOP-007 q2-2): '2 options: … $8,400 or upgrade … $11,200' drafted as 2×$8,400 + 3×$0 is saved at the first option's $8,400, never $16,800", async () => {
  const ctx = await fresh();
  always(ctx.llm, q22Draft("Drafting a quote."));
  const conv = await ctx.conversations.create({ userId: "u-1" });
  const result = await ctx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: Q22,
  });
  const saved = await ctx.quotes.listByUser("u-1");
  assert(saved.length >= 1, "no quote was drafted");
  for (const q of saved) {
    const lines = JSON.stringify(
      q.lineItems.map((l) => [l.description, l.price]),
    );
    assert(
      totalSaved(q) !== Q22_DOUBLED && totalOf(q) !== Q22_DOUBLED,
      `a saved quote totals $16,800 — the first option billed twice (estimatedTotal ${q.estimatedTotal}, lines ${lines})`,
    );
    assert(
      totalOf(q) === 840_000 || totalOf(q) === 1_120_000,
      `a saved quote totals ${totalOf(q)} — neither option ($8,400 / $11,200): ${lines}`,
    );
  }
  const shown = textOf(result.newMessages);
  assert(!shown.includes("16,800"), `the reply names $16,800: ${shown}`);
  assert(
    !shown.includes(String(Q22_DOUBLED)),
    `the card totals 1680000: ${shown}`,
  );
  assert(
    /option/i.test(shown),
    `the reply never says it drafted one of the two options: ${shown}`,
  );
  await resetKv();
});

Deno.test("REQ-1019 (LOOP-007 q2-2): the correction 'total should not be 16,800' never re-saves the $16,800 draft", async () => {
  const ctx = await fresh();
  // Turn 1 is answered with the first option alone, so this test isolates
  // the correction turn: the options were typed in an EARLIER message, and
  // the model's next answer (the $16,800 lines) must still be narrowed.
  always(ctx.llm, {
    text: "Drafting a quote.",
    action: {
      type: "create_quote",
      payload: {
        summary: "Master bath redo — Maria Gonzalez",
        lineItems: Q22_LINES.filter((l) => !/upgrade/i.test(l.description)),
      },
    },
  });
  const conv = await ctx.conversations.create({ userId: "u-1" });
  await ctx.flow.run({ userId: "u-1", conversationId: conv.id, content: Q22 });
  const first = await ctx.quotes.listByUser("u-1");
  assert(
    first.length === 1 && totalOf(first[0]) === 840_000,
    `setup: turn 1 should save the first option at $8,400, got ${
      JSON.stringify(first.map((q) => totalOf(q)))
    }`,
  );
  // the model re-sends the doubled lines on the correction turn
  always(ctx.llm, q22Draft("Updated the quote."));
  const second = await ctx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "total should not be 16,800",
  });
  for (const q of await ctx.quotes.listByUser("u-1")) {
    assert(
      totalSaved(q) !== Q22_DOUBLED && totalOf(q) !== Q22_DOUBLED,
      `after "total should not be 16,800" a saved quote still totals $16,800 (estimatedTotal ${q.estimatedTotal}, lines ${
        JSON.stringify(q.lineItems.map((l) => [l.description, l.price]))
      })`,
    );
  }
  const shown = textOf(second.newMessages);
  assert(
    !shown.includes(String(Q22_DOUBLED)),
    `the correction's card still totals 1680000: ${shown}`,
  );
  await resetKv();
});
