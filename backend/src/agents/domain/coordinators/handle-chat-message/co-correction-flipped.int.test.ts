/**
 * REQ-755 (demo-loop cycle 5v1, M15 re-test) — on the merged demo-fixes the
 * verifier had Q-002 for the Gomezes with "Door trim" at $200 and typed
 * "door trim for the gomezes is not 200, it's 275". The reply was "Updated
 * the quote: Door trim $200 → $275. Total $2,000 → $2,075. Added Door trim
 * ($75.00) to Q-002 … Total $2,000.00 → $2,150.00.": the model called
 * revise_quote AND change_order (+$75), and the change order was appended as
 * a second door trim line. A correction of a line is that line's new price —
 * a change order about the same line is never a second one.
 */
import { assert, assertEquals } from "#std/assert";
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
import { EventBus } from "@core/business/events/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";
import { ChangeOrderStore } from "@paperwork/domain/data/change-order-store/mod.ts";
import type { SendChangeOrderAlert } from "@paperwork/domain/coordinators/send-change-order-alert/mod.ts";
import { ApplyChatChangeOrder } from "@agents/domain/coordinators/apply-chat-change-order/mod.ts";
import { ReviseQuote } from "@agents/domain/coordinators/revise-quote/mod.ts";

const U = "u-755";

/** A contractor past the assistant's onboarding questions. */
async function seedOnboarded(language: "en" | "es") {
  const kv = await getKv();
  const now = new Date().toISOString();
  await kv.set(["user", U], {
    id: U,
    phoneNumber: "+15125550105",
    name: "Pat Painter",
    email: "pat@test.dev",
    language,
    createdAt: now,
    updatedAt: now,
  });
  await new BusinessIdentityStore().upsert(U, {
    businessName: "Pat LLC",
    acceptedPaymentMethods: { venmo: { enabled: true, handle: "@pat" } },
  });
  await new BusinessAddressStore().upsert(U, {
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
  const changeOrders = new ChangeOrderStore();
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
    new ApplyChatChangeOrder(quotes, invoices, changeOrders, customers, alert),
    new ReviseQuote(quotes, customers),
    undefined,
    customers,
  );
  /** Every model call, so a test can say "the model was never asked". */
  const calls: string[] = [];
  const script: unknown[] = [];
  llm.setHandler((req) => {
    const last = [...req.messages].reverse().find((m) => m.role === "user");
    calls.push(String(last?.content ?? ""));
    // deno-lint-ignore no-explicit-any
    return (script.shift() ?? { text: "(stub)" }) as any;
  });
  return {
    conversations,
    messages,
    quotes,
    invoices,
    customers,
    changeOrders,
    flow,
    calls,
    script,
  };
}

type F = ReturnType<typeof fresh>;

async function setup(language: "en" | "es") {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  await seedOnboarded(language);
  return fresh();
}

const say = async (f: F, conversationId: string, content: string) =>
  await f.flow.run({ userId: U, conversationId, content });

const texts = (r: { newMessages: { role: string; content: string }[] }) =>
  r.newMessages.filter((m) => m.role === "assistant").map((m) => m.content)
    .join("\n");

import type { LLMAction } from "@agents/domain/business/llm/base/mod.ts";

const VERIFIER = "door trim for the gomezes is not 200, it's 275";

type Line = { description: string; quantity?: number; price: number };

/** Q-002, the Gomezes' job with the $200 door trim: a draft, or sent. */
async function gomezQuote(f: F, status: "draft" | "sent") {
  const gomezes = await f.customers.create(U, { name: "Gomezes" });
  const lineItems: Line[] = [
    { description: "Interior door install", price: 180_000 },
    { description: "Door trim", price: 20_000 },
  ];
  const quote = await f.quotes.create(U, {
    summary: "Door replacement",
    jobName: "Door replacement",
    customerId: gomezes.id,
    lineItems: lineItems.map((l) => ({ unit: "ea", quantity: 1, ...l })),
    estimatedTotal: 200_000,
  } as never);
  return status === "draft" ? quote : await f.quotes.update(quote.id, U, {
    status: "sent",
    sentAt: new Date().toISOString(),
  });
}

const REPRICE: LLMAction = {
  type: "revise_quote",
  payload: {
    customerName: "Gomezes",
    lines: [{ match: "door trim", amountCents: 27_500 }],
    remove: [],
  },
};
/** What the model ALSO called in the failing try: the difference, as a CO. */
const DIFF_CO: LLMAction = {
  type: "change_order",
  payload: {
    customerName: "Gomezes",
    description: "Door trim",
    deltaAmountCents: 7_500,
  },
};

const linesOf = (ls: Line[] | undefined) =>
  (ls ?? []).map((l) => [l.description, l.price]);

Deno.test("REQ-755 M15: the verifier's try — revise_quote $275 AND change_order +$75 on draft Q-002 — leaves ONE door trim at $275, total $2,075, nothing 'Added'", async () => {
  const f = await setup("en");
  const quote = await gomezQuote(f, "draft");
  const conv = await f.conversations.create({ userId: U, quoteId: quote.id });
  f.script.push({ text: "", action: REPRICE, actions: [REPRICE, DIFF_CO] });
  const r = await say(f, conv.id, VERIFIER);

  const stored = await f.quotes.getOwned(quote.id, U);
  assertEquals(linesOf(stored.lineItems as Line[]), [
    ["Interior door install", 180_000],
    ["Door trim", 27_500],
  ]);
  assertEquals(stored.estimatedTotal, 207_500);
  const out = texts(r);
  assert(!/Added Door trim/i.test(out), out);
  assert(!/\$75\.00/.test(out), out);
  assert(!/2,150/.test(out), out);
  assert(out.includes("$275"), out);
});

Deno.test("REQ-755 M15: the model's change_order +$75 alone, on draft Q-002, reprices the door trim to $275 — never a second line", async () => {
  const f = await setup("en");
  const quote = await gomezQuote(f, "draft");
  const conv = await f.conversations.create({ userId: U, quoteId: quote.id });
  f.script.push({ text: "", action: DIFF_CO });
  const r = await say(f, conv.id, VERIFIER);

  const stored = await f.quotes.getOwned(quote.id, U);
  assertEquals(linesOf(stored.lineItems as Line[]), [
    ["Interior door install", 180_000],
    ["Door trim", 27_500],
  ]);
  const out = texts(r);
  assert(!/Added Door trim/i.test(out), out);
  assert(out.includes("$275"), out);
});

Deno.test("REQ-755 M15: on SENT Q-002 the same two calls leave Version 2 with one door trim at $275", async () => {
  const f = await setup("en");
  const quote = await gomezQuote(f, "sent");
  const conv = await f.conversations.create({ userId: U, quoteId: quote.id });
  f.script.push({ text: "", action: REPRICE, actions: [REPRICE, DIFF_CO] });
  const r = await say(f, conv.id, VERIFIER);

  const pending = (await f.quotes.getOwned(quote.id, U)).pendingRevision;
  assertEquals(linesOf(pending?.lineItems as Line[]), [
    ["Interior door install", 180_000],
    ["Door trim", 27_500],
  ]);
  assertEquals(pending?.estimatedTotal, 207_500);
  const out = texts(r);
  assert(!/Added Door trim/i.test(out), out);
  assert(!/2,150/.test(out), out);
});

Deno.test("REQ-755 M15: on SIGNED Q-002 the model's +$75 change order for the corrected door trim carries the $75 difference once — the reprice is refused, nothing doubled", async () => {
  const f = await setup("en");
  const sent = await gomezQuote(f, "sent");
  const quote = await f.quotes.update(sent.id, U, {
    status: "accepted",
    acceptedAt: new Date().toISOString(),
  } as never);
  const conv = await f.conversations.create({ userId: U, quoteId: quote.id });
  f.script.push({ text: "", action: DIFF_CO });
  const r = await say(f, conv.id, VERIFIER);

  const stored = await f.quotes.getOwned(quote.id, U);
  assertEquals(linesOf(stored.lineItems as Line[]), [
    ["Interior door install", 180_000],
    ["Door trim", 20_000],
  ], "a signed quote's lines never change");
  const out = texts(r);
  assert(out.includes("$75.00"), out);
  assert(!/\$275\.00\)/.test(out), out);
  assert(!/2,350/.test(out), out);
});
