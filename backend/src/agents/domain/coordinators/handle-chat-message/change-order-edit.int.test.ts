/**
 * REQ-462 (demo-loop cycle 3, M26) — HandleChatMessage edits or withdraws an
 * EXISTING change order named by its number.
 *
 * Pair 5 (fleet-4 stdout:288): Q-001 "Bathroom Remodel" was signed, CO-001
 * (+$1,200.00) waited on the draft INV-002, and the contractor typed
 *   Change of plan on CO-001: make it $1,000 and the description should just
 *   say "Upgrade to frameless glass shower door".
 * Nothing read "CO-001"; the model called revise_quote on Q-001 and the reply
 * was "Q-001 Bathroom Remodel is signed, so its lines can't change. Add or
 * credit the difference with a change order instead." — CO-001 stayed as it
 * was. The stub model below is scripted to make that same call.
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
import type { AgentMessage } from "@agents/dto/message.ts";

const DEMO =
  'Change of plan on CO-001: make it $1,000 and the description should just say "Upgrade to frameless glass shower door".';

async function seedOnboarded(userId: string, language: "en" | "es" = "en") {
  const kv = await getKv();
  const now = new Date().toISOString();
  await kv.set(["user", userId], {
    id: userId,
    phoneNumber: "+15125550000",
    name: "Aisha Bello",
    email: "aisha@test.dev",
    language,
    createdAt: now,
    updatedAt: now,
  });
  await new BusinessIdentityStore().upsert(userId, {
    businessName: "Bello Remodeling",
    acceptedPaymentMethods: { venmo: { enabled: true, handle: "@bello" } },
  });
  await new BusinessAddressStore().upsert(userId, {
    city: "Austin",
    state: "TX",
    postal: "78701",
  });
}

/** The edit coordinator, loaded lazily: before it exists the chat runs as
 *  it did in the demo, so the test reds on the demo's reply, not on a
 *  missing import. */
async function editCoordinator(
  changeOrders: ChangeOrderStore,
  invoices: InvoiceStore,
  quotes: QuoteStore,
  alert: SendChangeOrderAlert,
): Promise<unknown> {
  const spec = "@agents/domain/coordinators/update-chat-change-order/mod.ts";
  try {
    const mod = await import(spec);
    return new mod.UpdateChatChangeOrder(changeOrders, invoices, quotes, alert);
  } catch {
    return undefined;
  }
}

async function fresh() {
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
  const changeOrders = new ChangeOrderStore();
  const alerted: string[] = [];
  const alert = {
    run: (id: string) => {
      alerted.push(id);
      return Promise.resolve({ ok: true });
    },
  } as unknown as SendChangeOrderAlert;
  const edit = await editCoordinator(changeOrders, invoices, quotes, alert);
  const args = [
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
    edit, // REQ-462
  ];
  const flow = new HandleChatMessage(
    ...(args as unknown as ConstructorParameters<typeof HandleChatMessage>),
  );
  // every chat-model call is recorded; by default the model makes the
  // demo's own mistake — revise_quote on the signed Q-001
  const chat: LLMRequest[] = [];
  let answer: (req: LLMRequest) => LLMResponse = () => DEMO_MISTAKE;
  llm.setHandler((req) => {
    chat.push(req);
    return answer(req);
  });
  return {
    conversations,
    messages,
    quotes,
    invoices,
    customers,
    changeOrders,
    alerted,
    flow,
    chat,
    answerWith: (fn: (req: LLMRequest) => LLMResponse) => {
      answer = fn;
    },
  };
}

const DEMO_MISTAKE: LLMResponse = {
  text: "",
  action: {
    type: "revise_quote",
    payload: {
      quoteNumber: "Q-001",
      lines: [{
        match: "Frameless glass shower door",
        description: "Upgrade to frameless glass shower door",
        amountCents: 100_000,
      }],
      remove: [],
    },
  },
};

/** Pair 5's state: Karen Mills signed Q-001 ($7,050) on 50/50 terms; INV-001
 *  went out, INV-002 is a draft, and CO-001 (+$1,200) waits on INV-002. */
async function seedKaren(
  f: Awaited<ReturnType<typeof fresh>>,
  language: "en" | "es" = "en",
) {
  await seedOnboarded("u-1", language);
  const karen = await f.customers.create("u-1", {
    name: "Karen Mills",
    email: "karen@blackhole.postmarkapp.com",
  });
  const now = new Date().toISOString();
  const draft = await f.quotes.create("u-1", {
    summary: "Bathroom Remodel — Karen Mills",
    jobName: "Bathroom Remodel",
    customerId: karen.id,
    lineItems: [
      {
        description: "Demo and haul-away",
        quantity: 1,
        unit: "job",
        price: 150_000,
      },
      {
        description: "Tile shower surround",
        quantity: 1,
        unit: "job",
        price: 555_000,
      },
    ],
    estimatedTotal: 705_000,
  });
  const quote = await f.quotes.update(draft.id, "u-1", {
    status: "accepted",
    sentAt: now,
    acceptedAt: now,
  });
  const inv1 = await f.invoices.create("u-1", {
    quoteId: quote.id,
    customerId: karen.id,
    amount: 352_500,
    status: "sent",
  } as never);
  const inv2 = await f.invoices.create("u-1", {
    quoteId: quote.id,
    customerId: karen.id,
    amount: 352_500,
    status: "draft",
  } as never);
  const co = await f.changeOrders.create("u-1", inv2.id, {
    description: "Frameless glass shower door upgrade",
    deltaAmountCents: 120_000,
    quoteId: quote.id,
    customerId: karen.id,
    originalAmountCents: 352_500,
  });
  const conv = await f.conversations.create({
    userId: "u-1",
    quoteId: quote.id,
    customerId: karen.id,
    currentPhase: "terms",
  });
  return { karen, quote, inv1, inv2, co, conv };
}

const lastReply = (msgs: AgentMessage[]) => msgs[msgs.length - 1];

async function say(
  f: Awaited<ReturnType<typeof fresh>>,
  conversationId: string,
  content: string,
) {
  return await f.flow.run({ userId: "u-1", conversationId, content });
}

Deno.test("REQ-462 M26: the demo's exact sentence updates CO-001 — Version 2, pending, $1,000.00, the new wording, re-alerted — without the model; no CO-002, Q-001 untouched", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = await fresh();
  const { quote, inv2, co, conv } = await seedKaren(f);
  assertEquals(co.number, "CO-001");
  assertEquals(quote.number, "Q-001");

  const res = await say(f, conv.id, DEMO);

  const reply = lastReply(res.newMessages);
  assertEquals(reply.role, "assistant");
  const after = await f.changeOrders.getOwned(co.id, "u-1");
  assertEquals(
    {
      description: after.description,
      delta: after.deltaAmountCents,
      status: after.status,
      version: after.version,
      original: after.originalAmountCents,
    },
    {
      description: "Upgrade to frameless glass shower door",
      delta: 100_000,
      status: "pending",
      version: 2,
      original: 352_500,
    },
    `CO-001 was not edited — the reply was: ${reply.content}`,
  );
  assertEquals(
    (await f.changeOrders.listByUser("u-1")).length,
    1,
    "no CO-002",
  );
  assertEquals(
    f.alerted,
    [co.id],
    "the edit re-alerts, as the invoices page's does",
  );
  assertEquals(f.chat.length, 0, "the model was never asked");
  // the invoice only moves when Karen approves
  assertEquals((await f.invoices.getOwned(inv2.id, "u-1")).amount, 352_500);
  const q = await f.quotes.getOwned(quote.id, "u-1");
  assertEquals(q.lineItems.length, 2);
  assertEquals(q.estimatedTotal, 705_000);
  assertEquals(q.pendingRevision, undefined, "no revision on the signed quote");
  assertEquals((await f.quotes.listByUser("u-1")).length, 1, "no new quote");

  assertStringIncludes(reply.content, "CO-001");
  assertStringIncludes(reply.content, "$1,000.00");
  assertStringIncludes(reply.content, "Upgrade to frameless glass shower door");
  assert(!/lines can't change/.test(reply.content), reply.content);
  assertEquals(
    (reply.payload as { changeOrderEdit?: unknown })?.changeOrderEdit,
    {
      kind: "updated",
      changeOrderId: co.id,
      number: "CO-001",
      version: 2,
      invoiceId: inv2.id,
      quoteId: quote.id,
      quoteNumber: "Q-001",
    },
  );
  await resetKv();
});

Deno.test("REQ-462 M26: 'withdraw CO-001' deletes the pending order and says so; nothing else changes", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = await fresh();
  const { quote, inv2, co, conv } = await seedKaren(f);

  const res = await say(f, conv.id, "Karen changed her mind — withdraw CO-001");

  const reply = lastReply(res.newMessages);
  assertEquals(
    await f.changeOrders.listByUser("u-1"),
    [],
    `CO-001 is still there — the reply was: ${reply.content}`,
  );
  assertEquals(f.chat.length, 0, "the model was never asked");
  assertEquals(f.alerted, []);
  assertEquals((await f.invoices.getOwned(inv2.id, "u-1")).amount, 352_500);
  assertStringIncludes(reply.content, "CO-001");
  assertEquals(
    (reply.payload as { changeOrderEdit?: unknown })?.changeOrderEdit,
    {
      kind: "withdrawn",
      changeOrderId: co.id,
      number: "CO-001",
      invoiceId: inv2.id,
      quoteId: quote.id,
      quoteNumber: "Q-001",
    },
  );
  await resetKv();
});

Deno.test("REQ-462 M26: an APPROVED change order is never changed from chat — the reply says to make a new one for the difference", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = await fresh();
  const { co, conv } = await seedKaren(f);
  await f.changeOrders.decide(co.id, "approved", {
    approvedName: "Karen Mills",
  });

  const res = await say(f, conv.id, "Make CO-001 $1,000");

  const after = await f.changeOrders.getOwned(co.id, "u-1");
  assertEquals([after.status, after.deltaAmountCents, after.version ?? 1], [
    "approved",
    120_000,
    1,
  ]);
  assertEquals(f.alerted, []);
  const reply = lastReply(res.newMessages);
  assertStringIncludes(reply.content, "CO-001");
  assertStringIncludes(reply.content, "approved");
  assertStringIncludes(reply.content, "new change order");
  assertEquals(
    (reply.payload as { changeOrderEdit?: { kind?: string } })?.changeOrderEdit
      ?.kind,
    "approved",
  );
  await resetKv();
});

Deno.test("REQ-462 M26: a CO number that matches nothing writes nothing and names that number", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = await fresh();
  const { co, conv } = await seedKaren(f);

  const res = await say(f, conv.id, "make CO-007 $500");

  const after = await f.changeOrders.getOwned(co.id, "u-1");
  assertEquals([after.deltaAmountCents, after.version ?? 1], [120_000, 1]);
  const reply = lastReply(res.newMessages);
  assertStringIncludes(reply.content, "CO-007");
  assertEquals(
    (reply.payload as { changeOrderEdit?: unknown })?.changeOrderEdit,
    { kind: "none", number: "CO-007" },
  );
  await resetKv();
});

Deno.test("REQ-462 M26: the same amount and wording is no change — no new version, no alert", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = await fresh();
  const { co, conv } = await seedKaren(f);

  const res = await say(f, conv.id, "make CO-001 $1,200");

  const after = await f.changeOrders.getOwned(co.id, "u-1");
  assertEquals([after.deltaAmountCents, after.version ?? 1], [120_000, 1]);
  assertEquals(f.alerted, []);
  assertEquals(
    (lastReply(res.newMessages).payload as {
      changeOrderEdit?: { kind?: string };
    })?.changeOrderEdit?.kind,
    "no_change",
  );
  await resetKv();
});

Deno.test("REQ-462 M26: a credit stays a credit — 'make CO-002 $50' on a −$80.00 credit writes −$50.00", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = await fresh();
  const { quote, inv2, karen, conv } = await seedKaren(f);
  const credit = await f.changeOrders.create("u-1", inv2.id, {
    description: "Credit for the missed visit",
    deltaAmountCents: -8_000,
    quoteId: quote.id,
    customerId: karen.id,
    originalAmountCents: 352_500,
  });
  assertEquals(credit.number, "CO-002");

  await say(f, conv.id, "make CO-002 $50");

  const after = await f.changeOrders.getOwned(credit.id, "u-1");
  assertEquals([after.deltaAmountCents, after.description, after.version], [
    -5_000,
    "Credit for the missed visit",
    2,
  ]);
  await resetKv();
});

Deno.test("REQ-462 M26: a sentence the parser can't read goes to the model with update_change_order offered and CO-001's state in its context; its call is executed", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = await fresh();
  const { co, conv } = await seedKaren(f);
  f.answerWith(() => ({
    text: "",
    action: {
      type: "update_change_order",
      payload: { changeOrderNumber: "CO-001", amountCents: 100_000 },
    } as unknown as LLMResponse["action"],
  }));

  await say(
    f,
    conv.id,
    "Karen wants the cheaper door after all — knock two hundred off CO-001",
  );

  assertEquals(f.chat.length, 1);
  const req = f.chat[0];
  assert(
    (req.tools as string[] | undefined)?.includes("update_change_order"),
    `tools offered: ${JSON.stringify(req.tools)}`,
  );
  assertStringIncludes(req.businessContext ?? "", "CO-001");
  assertStringIncludes(req.businessContext ?? "", "$1,200.00");
  assertStringIncludes(req.businessContext ?? "", "update_change_order");
  const after = await f.changeOrders.getOwned(co.id, "u-1");
  assertEquals([after.deltaAmountCents, after.version, after.description], [
    100_000,
    2,
    "Frameless glass shower door upgrade",
  ]);
  assertEquals(f.alerted, [co.id]);
  await resetKv();
});

Deno.test("REQ-462 M26: the model's revise_quote on a message that names a change order is never run — the reply asks what to change on CO-001", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = await fresh();
  const { quote, co, conv } = await seedKaren(f);

  const res = await say(f, conv.id, "About CO-001 — Karen called again");

  assertEquals(f.chat.length, 1, "the model read it");
  const reply = lastReply(res.newMessages);
  assert(!/lines can't change/.test(reply.content), reply.content);
  assertStringIncludes(reply.content, "CO-001");
  const after = await f.changeOrders.getOwned(co.id, "u-1");
  assertEquals([after.deltaAmountCents, after.version ?? 1], [120_000, 1]);
  const q = await f.quotes.getOwned(quote.id, "u-1");
  assertEquals(q.pendingRevision, undefined);
  await resetKv();
});

Deno.test("REQ-462 M26: a Spanish-speaking contractor gets the reply in Spanish — 'Cambia CO-001 a $1,000'", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = await fresh();
  const { co, conv } = await seedKaren(f, "es");

  const res = await say(f, conv.id, "Cambia CO-001 a $1,000");

  const after = await f.changeOrders.getOwned(co.id, "u-1");
  assertEquals([after.deltaAmountCents, after.version], [100_000, 2]);
  const reply = lastReply(res.newMessages);
  assertStringIncludes(reply.content, "CO-001");
  assertStringIncludes(reply.content, "Actualicé");
  await resetKv();
});
