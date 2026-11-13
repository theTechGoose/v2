/**
 * REQ-767 (demo-loop cycle 5v2, m43 — the verifier's re-test of REQ-664).
 *
 * verify1b fleet-4 stdout:31-33: Carmen Núñez's Q-001 (one line, "Reparar
 * fuga debajo del fregadero (incluye cambiar llave del fregadero)" $350) was
 * signed. Try 1 ("…to $425") got the one-tap offer. Try 2 in the same thread,
 * "On Q-001, lower the line to $300 — I'm giving Carmen a discount.", got a
 * model's text-only "Would you like me to create a change order for a $100
 * discount" — no button, wrong amount. Try 3 in a new thread, "Update Carmen
 * Núñez's plumbing quote Q-001: the sink repair line should be $400 instead
 * of $350.", got the bare locked refusal with only "Open Q-001": the model's
 * "sink repair" named no line of the Spanish quote, so no offer was made.
 */
import { assertEquals, assertStringIncludes } from "#std/assert";
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

const MODEL_TEXT: LLMResponse = { text: "MODEL ANSWERED" };

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
  const alerted: unknown[] = [];
  const alert = {
    run: (x: unknown) => {
      alerted.push(x);
      return Promise.resolve({ ok: true });
    },
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
  const chat: LLMRequest[] = [];
  const script: LLMResponse[] = [];
  llm.setHandler((req) => {
    chat.push(req);
    return script.shift() ?? MODEL_TEXT;
  });
  return {
    conversations,
    quotes,
    invoices,
    customers,
    changeOrders,
    flow,
    chat,
    script,
    alerted,
  };
}

/** verify1b: Carmen's Q-001 — one Spanish line, $350, Due Now, signed in
 *  person; its invoice is open. */
async function seedCarmen(
  f: ReturnType<typeof fresh>,
  lines: {
    description: string;
    descriptionByLang?: Record<string, string>;
    price: number;
  }[] = [
    { description: SINK, price: 35_000 },
  ],
  signed = true,
) {
  await seedOnboarded("u-1", "en");
  const carmen = await f.customers.create("u-1", { name: "Carmen Núñez" });
  const now = new Date().toISOString();
  const draft = await f.quotes.create("u-1", {
    summary: "Reparación de plomería — Carmen Núñez",
    jobName: "Reparación de plomería",
    customerId: carmen.id,
    lineItems: lines.map((l) => ({ ...l, quantity: 1, unit: "job" })),
    estimatedTotal: lines.reduce((s, l) => s + l.price, 0),
  });
  const quote = await f.quotes.update(
    draft.id,
    "u-1",
    signed
      ? { status: "accepted", sentAt: now, acceptedAt: now }
      : { status: "sent", sentAt: now },
  );
  // "Due Now — full amount due on signing": the invoice is open
  await f.invoices.create("u-1", {
    quoteId: quote.id,
    customerId: carmen.id,
    amount: quote.estimatedTotal,
    status: "sent",
  } as never);
  const conv = await f.conversations.create(
    { userId: "u-1", quoteId: quote.id } as never,
  );
  return { quote, conv };
}
const SINK =
  "Reparar fuga debajo del fregadero (incluye cambiar llave del fregadero)";

type Offer = {
  quoteId: string;
  quoteNumber?: string;
  deltaCents: number;
  description: string;
  label: string;
};
const revOf = (m: AgentMessage) =>
  (m.payload as { quoteRevision?: { kind?: string; changeOrderOffer?: Offer } })
    ?.quoteRevision;

const say = (
  f: ReturnType<typeof fresh>,
  conversationId: string,
  content: string,
) => f.flow.run({ userId: "u-1", conversationId, content });

Deno.test("REQ-767 m43 verifier: try 1 offer taken, then try 2 'lower the line to $300' (the model would only answer in text) offers −$50 with the button — read in code, the model never asked", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = fresh();
  const { quote, conv } = await seedCarmen(f);
  // try 1: the model's revise_quote, as in the demo
  f.script.push({
    text: "",
    action: {
      type: "revise_quote",
      payload: {
        quoteNumber: "Q-001",
        lines: [{ match: SINK, amountCents: 42_500 }],
        remove: [],
      },
    },
  });
  const r1 = await say(
    f,
    conv.id,
    "Change the price on Q-001 for Carmen to $425 — the faucet she picked costs more.",
  );
  assertEquals(
    revOf(r1.newMessages.at(-1)!)?.changeOrderOffer?.deltaCents,
    7_500,
  );
  await say(f, conv.id, "yes");
  assertEquals(
    (await f.changeOrders.listByUser("u-1")).map((c) => c.deltaAmountCents),
    [7_500],
  );
  // try 2: the demo's model answered this in text — it is never asked now
  const calls = f.chat.length;
  f.script.push({
    text:
      "To change the price on an existing line in Q-001, I need to create a new change order instead. Would you like me to create a change order for a $100 discount on the line item?",
  });
  const r2 = await say(
    f,
    conv.id,
    "On Q-001, lower the line to $300 — I'm giving Carmen a discount.",
  );
  assertEquals(f.chat.length, calls, "read in code, not by the model");
  const reply = r2.newMessages.at(-1)!;
  const rev = revOf(reply);
  assertEquals(rev?.kind, "locked", reply.content);
  assertEquals(rev?.changeOrderOffer, {
    quoteId: quote.id,
    quoteNumber: "Q-001",
    deltaCents: -5_000,
    description: `${SINK}: $350.00 → $300.00`,
    label: SINK,
  });
  assertStringIncludes(reply.content, "−$50");
  // the offer is one tap: "yes" makes the −$50 change order, still unsent
  await say(f, conv.id, "yes");
  const cos = await f.changeOrders.listByUser("u-1");
  assertEquals(cos.map((c) => c.deltaAmountCents).sort(), [-5_000, 7_500]);
  // REQ-652 (M8): made as a draft — Carmen is neither emailed nor texted
  assertEquals(f.alerted, [], "the change orders are not sent");
  const stored = await f.quotes.getOwned(quote.id, "u-1");
  assertEquals(stored.lineItems[0].price, 35_000, "Q-001's line stays");
  await resetKv();
});

Deno.test("REQ-767 m43 verifier: try 3 in a NEW thread, 'the sink repair line should be $400 instead of $350.' on the Spanish-only Q-001 offers +$50", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = fresh();
  const { quote } = await seedCarmen(f);
  const conv = await f.conversations.create({ userId: "u-1" });
  // what the demo's model sent: an English line name the quote doesn't carry
  f.script.push({
    text: "",
    action: {
      type: "revise_quote",
      payload: {
        quoteNumber: "Q-001",
        customerName: "Carmen Núñez",
        lines: [{ match: "sink repair", amountCents: 40_000 }],
        remove: [],
      },
    },
  });
  const r = await say(
    f,
    conv.id,
    "Update Carmen Núñez's plumbing quote Q-001: the sink repair line should be $400 instead of $350.",
  );
  const reply = r.newMessages.at(-1)!;
  const rev = revOf(reply);
  assertEquals(rev?.kind, "locked", reply.content);
  assertEquals(rev?.changeOrderOffer?.quoteId, quote.id);
  assertEquals(rev?.changeOrderOffer?.deltaCents, 5_000);
  assertEquals(rev?.changeOrderOffer?.label, SINK);
  assertStringIncludes(reply.content, "+$50");
  assertEquals(await f.changeOrders.listByUser("u-1"), []);
  await resetKv();
});

Deno.test("REQ-767 m43: the model's own revise_quote naming the line in English ('sink repair') or as 'the line' still gets the offer", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  for (const match of ["sink repair", "the line"]) {
    await resetKv();
    const f = fresh();
    const { conv } = await seedCarmen(f);
    f.script.push({
      text: "",
      action: {
        type: "revise_quote",
        payload: {
          quoteNumber: "Q-001",
          lines: [{ match, amountCents: 40_000 }],
          remove: [],
        },
      },
    });
    const r = await say(f, conv.id, "make it four hundred on Q-001");
    assertEquals(
      revOf(r.newMessages.at(-1)!)?.changeOrderOffer?.deltaCents,
      5_000,
      match,
    );
  }
  await resetKv();
});

Deno.test("REQ-767 m43: on a two-line signed quote the English name finds the Spanish line through its translation", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = fresh();
  const { conv } = await seedCarmen(f, [
    {
      description: "Demolición",
      descriptionByLang: { en: "Demolition" },
      price: 20_000,
    },
    {
      description: SINK,
      descriptionByLang: {
        en: "Repair leak under the sink (includes replacing the sink faucet)",
      },
      price: 35_000,
    },
  ]);
  const r = await say(
    f,
    conv.id,
    "the sink repair line should be $400 instead of $350.",
  );
  const offer = revOf(r.newMessages.at(-1)!)?.changeOrderOffer;
  assertEquals(offer?.deltaCents, 5_000);
  assertEquals(offer?.label, SINK);
  await resetKv();
});

Deno.test("REQ-767 m43: on an unsigned (sent) quote the same ask is the model's — nothing is read in code", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = fresh();
  const { conv } = await seedCarmen(f, undefined, false);
  const r = await say(f, conv.id, "On Q-001, lower the line to $300");
  assertEquals(f.chat.length, 1, "the model was asked");
  assertEquals(r.newMessages.at(-1)!.content, "MODEL ANSWERED");
  await resetKv();
});
