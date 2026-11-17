/**
 * REQ-769 (demo-loop cycle 5v4, M10 re-test) — the verifier, in Tom
 * Henderson's Q-002 thread, typed "Change Dana Whitfield's quote: add post
 * caps for $300" and "Change Dana Whitfield's quote: add a shower niche for
 * $250". Both got the model's "Please provide the quote number for Dana
 * Whitfield's quote so I can add the post caps for $300." — no tool call —
 * though Dana's only quote, Q-001, was on file. The ask is read in code and
 * lands on her quote; the model is never asked.
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

const U = "u-769";

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
  const script: { text: string }[] = [];
  llm.setHandler((req) => {
    const last = [...req.messages].reverse().find((m) => m.role === "user");
    calls.push(String(last?.content ?? ""));
    return script.shift() ?? { text: "(stub)" };
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

async function setup() {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  await seedOnboarded("en");
  return fresh();
}

const say = async (f: F, conversationId: string, content: string) =>
  await f.flow.run({ userId: U, conversationId, content });

const texts = (r: { newMessages: { role: string; content: string }[] }) =>
  r.newMessages.filter((m) => m.role === "assistant").map((m) => m.content)
    .join("\n");

/** What the verifier's model answered instead of acting. */
const MODEL_ASKS = {
  text:
    "Please provide the quote number for Dana Whitfield's quote so I can add the post caps for $300.",
};

/** Dana's Q-001 (sent, or an unlinked chat draft) and Tom's Q-002, whose
 *  thread the verifier was typing in. */
async function seed(f: F, dana: "sent" | "unlinked-draft") {
  const danaRec = dana === "sent"
    ? await f.customers.create(U, { name: "Dana Whitfield" })
    : undefined;
  const q1 = await f.quotes.create(U, {
    summary: "Fence install — Dana Whitfield",
    jobName: "Fence install",
    ...(danaRec ? { customerId: danaRec.id } : {}),
    lineItems: [{
      description: "Cedar fence, 120 ft",
      quantity: 1,
      unit: "ea",
      price: 600_000,
    }],
    estimatedTotal: 600_000,
  } as never);
  const danaQuote = dana === "sent"
    ? await f.quotes.update(q1.id, U, {
      status: "sent",
      sentAt: new Date().toISOString(),
    })
    : q1;
  const tom = await f.customers.create(U, { name: "Tom Henderson" });
  const tomQuote = await f.quotes.create(U, {
    summary: "Deck repair",
    jobName: "Deck repair",
    customerId: tom.id,
    lineItems: [{
      description: "Deck boards",
      quantity: 1,
      unit: "ea",
      price: 250_000,
    }],
    estimatedTotal: 250_000,
  } as never);
  const conv = await f.conversations.create({
    userId: U,
    quoteId: tomQuote.id,
  });
  return { danaQuote, tomQuote, conv };
}

const linesOf = (q: { lineItems?: { description: string; price: number }[] }) =>
  (q.lineItems ?? []).map((l) => [l.description, l.price]);

Deno.test("REQ-769 M10: from Tom's Q-002 thread, both of the verifier's 'Change Dana Whitfield's quote: add …' land on her sent Q-001 — no quote number asked", async () => {
  const f = await setup();
  const { danaQuote, tomQuote, conv } = await seed(f, "sent");
  assertEquals(danaQuote.number, "Q-001");
  assertEquals(tomQuote.number, "Q-002");
  f.script.push(MODEL_ASKS, MODEL_ASKS);

  const r1 = await say(
    f,
    conv.id,
    "Change Dana Whitfield's quote: add post caps for $300",
  );
  const r2 = await say(
    f,
    conv.id,
    "Change Dana Whitfield's quote: add a shower niche for $250",
  );

  const out = texts(r1) + "\n" + texts(r2);
  assert(!/quote number/i.test(out), out);
  assertEquals(f.calls.length, 0, "read in code, the model is never asked");
  const dana = await f.quotes.getOwned(danaQuote.id, U);
  assertEquals(
    (dana.pendingRevision?.lineItems as {
      description: string;
      price: number;
    }[]).map((l) => [l.description, l.price]),
    [
      ["Cedar fence, 120 ft", 600_000],
      ["Post caps", 30_000],
      ["Shower niche", 25_000],
    ],
  );
  assert(out.includes("Post caps"), out);
  assert(out.includes("Q-001"), out);
  // Tom's quote is untouched
  assertEquals(linesOf(await f.quotes.getOwned(tomQuote.id, U)), [
    ["Deck boards", 250_000],
  ]);
});

Deno.test("REQ-769 M10: Dana's Q-001 is a chat draft with no customer linked — 'Change Dana Whitfield's quote: add post caps for $300' adds the line to it", async () => {
  const f = await setup();
  const { danaQuote, tomQuote, conv } = await seed(f, "unlinked-draft");
  f.script.push(MODEL_ASKS);

  const r = await say(
    f,
    conv.id,
    "Change Dana Whitfield's quote: add post caps for $300",
  );

  const out = texts(r);
  assert(!/quote number/i.test(out), out);
  assertEquals(f.calls.length, 0, "read in code, the model is never asked");
  assertEquals(linesOf(await f.quotes.getOwned(danaQuote.id, U)), [
    ["Cedar fence, 120 ft", 600_000],
    ["Post caps", 30_000],
  ]);
  assertEquals(linesOf(await f.quotes.getOwned(tomQuote.id, U)), [
    ["Deck boards", 250_000],
  ]);
});
