/**
 * REQ-661 (demo-loop cycle 5, M15) — pair 6 sent Q-001 to the Hendersons,
 * then typed "heated floor for the hendersons is $1,200 not 150. add it as a
 * change order please". The reply was "Added Heated floor for the hendersons
 * is not 150 ($1,200.00) to Q-001 … as a revision": the sentence became the
 * line's name, a $150 heated floor line was left next to the new one, and
 * nothing said why a change order became a revision.
 *
 * Now: the line is "Heated floor" at $1,200 — a heated floor line already on
 * the job is repriced, never doubled — and the reply says a change order
 * applies after signing, so this waits as Version 2.
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

const U = "u-661";

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

const DEMO =
  "heated floor for the hendersons is $1,200 not 150. add it as a change order please";

type Line = { description: string; quantity?: number; price: number };

/** Q-001, the Hendersons' bath + kitchen job: sent (or a draft). */
async function hendersonsQuote(
  f: F,
  status: "draft" | "sent",
  lineItems: Line[] = [
    { description: "Master bath remodel", quantity: 1, price: 1_200_000 },
    { description: "Kitchen backsplash", quantity: 1, price: 675_000 },
  ],
) {
  const hendersons = await f.customers.create(U, { name: "Hendersons" });
  const quote = await f.quotes.create(U, {
    summary: "Master Bath & Kitchen",
    jobName: "Master Bath & Kitchen",
    customerId: hendersons.id,
    lineItems: lineItems.map((l) => ({ unit: "ea", quantity: 1, ...l })),
    estimatedTotal: lineItems.reduce((s, l) => s + l.price, 0),
  } as never);
  return status === "draft" ? quote : await f.quotes.update(quote.id, U, {
    status: "sent",
    sentAt: new Date().toISOString(),
  });
}

const pendingLines = async (f: F, id: string) =>
  ((await f.quotes.getOwned(id, U)).pendingRevision?.lineItems as Line[])
    .map((l) => [l.description, l.price]);

Deno.test("REQ-661 M15: the demo's correction on sent Q-001 adds 'Heated floor' $1,200 — never the sentence — and says why it is a revision, not a change order", async () => {
  const f = await setup("en");
  const quote = await hendersonsQuote(f, "sent");
  // as in the demo: the conversation is Q-001's
  const conv = await f.conversations.create({ userId: U, quoteId: quote.id });
  const r = await say(f, conv.id, DEMO);

  assertEquals(f.calls.length, 0, "read in code, the model is never asked");
  assertEquals(await pendingLines(f, quote.id), [
    ["Master bath remodel", 1_200_000],
    ["Kitchen backsplash", 675_000],
    ["Heated floor", 120_000],
  ]);
  const out = texts(r);
  assert(!/not 150|hendersons is/i.test(out), out);
  assert(out.includes("Heated floor ($1,200.00)"), out);
  assert(out.includes("A change order applies after signing"), out);
  assert(out.includes("Version 2"), out);
  assert(out.includes("Publish revision"), out);
});

Deno.test("REQ-661 M15: when the job's next version already has the wrong $150 heated floor, the correction reprices THAT line — one heated floor, at $1,200", async () => {
  const f = await setup("en");
  const quote = await hendersonsQuote(f, "sent");
  await f.quotes.setPending(quote.id, U, {
    lineItems: [
      ...quote.lineItems,
      {
        description: "Heated floor in bath, 64 sqft",
        quantity: 1,
        unit: "ea",
        price: 15_000,
      },
    ],
    estimatedTotal: 1_890_000,
  });
  const conv = await f.conversations.create({ userId: U });
  const r = await say(f, conv.id, DEMO);

  assertEquals(await pendingLines(f, quote.id), [
    ["Master bath remodel", 1_200_000],
    ["Kitchen backsplash", 675_000],
    ["Heated floor in bath, 64 sqft", 120_000],
  ]);
  assertEquals(
    (await f.quotes.getOwned(quote.id, U)).pendingRevision?.estimatedTotal,
    1_995_000,
  );
  const out = texts(r);
  assert(out.includes("$150.00"), out);
  assert(out.includes("$1,200.00"), out);
  assert(out.includes("A change order applies after signing"), out);
});

Deno.test("REQ-661 M15: a draft's wrong heated floor line is repriced in place, not doubled", async () => {
  const f = await setup("en");
  const quote = await hendersonsQuote(f, "draft", [
    { description: "Master bath remodel", price: 1_200_000 },
    { description: "Heated floor", price: 15_000 },
  ]);
  const conv = await f.conversations.create({ userId: U });
  await say(f, conv.id, DEMO);

  const stored = await f.quotes.getOwned(quote.id, U);
  assertEquals(stored.lineItems.map((l) => [l.description, l.price]), [
    ["Master bath remodel", 1_200_000],
    ["Heated floor", 120_000],
  ]);
  assertEquals(stored.estimatedTotal, 1_320_000);
});

Deno.test("REQ-661 M15: a Spanish-speaking contractor is told in Spanish why it is a revision", async () => {
  const f = await setup("es");
  const quote = await hendersonsQuote(f, "sent");
  const conv = await f.conversations.create({ userId: U });
  const r = await say(
    f,
    conv.id,
    "el piso radiante para los Henderson es $1,200, no 150. agrégalo como orden de cambio",
  );

  assertEquals((await pendingLines(f, quote.id)).at(-1), [
    "Piso radiante",
    120_000,
  ]);
  const out = texts(r);
  assert(
    out.includes("Una orden de cambio se aplica después de la firma"),
    out,
  );
  assert(out.includes("Versión 2"), out);
});
