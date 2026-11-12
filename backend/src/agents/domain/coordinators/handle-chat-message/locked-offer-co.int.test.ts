/**
 * REQ-664 (demo-loop cycle 5, m43, run r37f88707) — a signed quote's line
 * edit OFFERS the change order instead of only refusing.
 *
 * Pair 5 (fleet-4 stdout:220): Aisha asked the assistant to make the signed
 * Q-001's cabinets cheaper. The reply was "Q-001 Kitchen Remodel is signed,
 * so its lines can't change. Add or credit the difference with a change
 * order instead." with only "Open Q-001" — she re-typed the whole thing as a
 * change order. The coordinator already knew the line and its new price, so
 * the reply now carries the difference (`quoteRevision.changeOrderOffer`),
 * and the chat's one-tap "Make change order −$1,000 for Cabinets" (which
 * sends those words) makes exactly that change order — without the model.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { t } from "@core/i18n/mod.ts";
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

/** The model's revise_quote for "Dana wants cheaper cabinets on Q-001 — make
 *  them $2,500" (the demo's ask on the signed quote). */
const CHEAPER_CABINETS: LLMResponse = {
  text: "",
  action: {
    type: "revise_quote",
    payload: {
      quoteNumber: "Q-001",
      lines: [{ match: "cabinets", amountCents: 250_000 }],
      remove: [],
    },
  },
};
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
  };
}

/** Pair 5: Dana Whitfield signed Q-001 Kitchen Remodel ($16,300); the
 *  deposit INV-001 is open. */
async function seedDana(f: ReturnType<typeof fresh>, lang: "en" | "es") {
  await seedOnboarded("u-1", lang);
  const dana = await f.customers.create("u-1", { name: "Dana Whitfield" });
  const line = (description: string, price: number) => ({
    description,
    quantity: 1,
    unit: "job",
    price,
  });
  const now = new Date().toISOString();
  const draft = await f.quotes.create("u-1", {
    summary: "Kitchen Remodel — Dana Whitfield",
    jobName: "Kitchen Remodel",
    customerId: dana.id,
    lineItems: [
      line("Demo and haul-away", 180_000),
      line("Cabinets", 350_000),
      line("Countertops", 1_100_000),
    ],
    estimatedTotal: 1_630_000,
  });
  const quote = await f.quotes.update(draft.id, "u-1", {
    status: "accepted",
    sentAt: now,
    acceptedAt: now,
  });
  const invoice = await f.invoices.create("u-1", {
    quoteId: quote.id,
    customerId: dana.id,
    amount: 815_000,
    status: "sent",
  } as never);
  const conv = await f.conversations.create({ userId: "u-1" });
  return { quote, invoice, conv };
}

type Offer = {
  quoteId: string;
  quoteNumber?: string;
  deltaCents: number;
  description: string;
  label: string;
};
const offerOf = (m: AgentMessage) =>
  (m.payload as { quoteRevision?: { kind?: string; changeOrderOffer?: Offer } })
    ?.quoteRevision;

const say = (
  f: ReturnType<typeof fresh>,
  conversationId: string,
  content: string,
) => f.flow.run({ userId: "u-1", conversationId, content });

Deno.test("REQ-664 m43: a line edit on the signed Q-001 is refused AND the reply offers the change order for the difference (−$1,000 for Cabinets) — nothing written yet", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = fresh();
  const { quote, conv } = await seedDana(f, "en");
  f.script.push(CHEAPER_CABINETS);
  const r = await say(
    f,
    conv.id,
    "Dana wants cheaper cabinets on Q-001, twenty-five hundred",
  );
  const reply = r.newMessages.at(-1)!;
  const rev = offerOf(reply);
  assertEquals(rev?.kind, "locked");
  assertEquals(rev?.changeOrderOffer, {
    quoteId: quote.id,
    quoteNumber: "Q-001",
    deltaCents: -100_000,
    description: "Cabinets: $3,500.00 → $2,500.00",
    label: "Cabinets",
  });
  assertStringIncludes(reply.content, "signed");
  assertStringIncludes(reply.content, "−$1,000");
  // the offer is only an offer: no change order, Q-001 untouched
  assertEquals(await f.changeOrders.listByUser("u-1"), []);
  const stored = await f.quotes.getOwned(quote.id, "u-1");
  assertEquals(stored.lineItems[1].price, 350_000);
  await resetKv();
});

Deno.test("REQ-664 m43: tapping 'Make change order −$1,000 for Cabinets' makes that change order on the open invoice — without the model; Q-001's lines stay", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = fresh();
  const { quote, invoice, conv } = await seedDana(f, "en");
  f.script.push(CHEAPER_CABINETS);
  await say(
    f,
    conv.id,
    "Dana wants cheaper cabinets on Q-001, twenty-five hundred",
  );
  const calls = f.chat.length;
  const label = t("en", "asstChat.changeOrderOffer", {
    amount: "−$1,000",
    what: "Cabinets",
  });
  assertEquals(label, "Make change order −$1,000 for Cabinets");
  const r = await say(f, conv.id, label);
  assertEquals(f.chat.length, calls, "the tap never reaches the model");
  const reply = r.newMessages.at(-1)!;
  const co = (reply.payload as { changeOrder?: { kind: string } })
    ?.changeOrder;
  assertEquals(co?.kind, "change_order", reply.content);
  const all = await f.changeOrders.listByUser("u-1");
  assertEquals(all.length, 1);
  assertEquals(all[0].deltaAmountCents, -100_000);
  assertEquals(all[0].invoiceId, invoice.id);
  assertEquals(all[0].quoteId, quote.id);
  assertEquals(all[0].description, "Cabinets: $3,500.00 → $2,500.00");
  const stored = await f.quotes.getOwned(quote.id, "u-1");
  assertEquals(stored.lineItems[1].price, 350_000);
  await resetKv();
});

Deno.test("REQ-664 m43: in Spanish the offer and its button are Spanish, and 'sí' takes the offer too", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = fresh();
  const { conv } = await seedDana(f, "es");
  f.script.push(CHEAPER_CABINETS);
  const r1 = await say(
    f,
    conv.id,
    "Dana quiere gabinetes más baratos en Q-001, dos mil quinientos",
  );
  const offer = offerOf(r1.newMessages.at(-1)!)?.changeOrderOffer;
  assertStringIncludes(
    r1.newMessages.at(-1)!.content,
    "Puedo hacer esa orden de cambio por ti: −$1,000 por Cabinets",
  );
  assertEquals(offer?.deltaCents, -100_000);
  assertStringIncludes(offer?.description ?? "", "Cabinets");
  const calls = f.chat.length;
  await say(f, conv.id, "sí");
  assertEquals(f.chat.length, calls, "the yes never reaches the model");
  const all = await f.changeOrders.listByUser("u-1");
  assertEquals(all.map((c) => c.deltaAmountCents), [-100_000]);
  await resetKv();
});

Deno.test("REQ-664 m43: anything else after the offer goes to the model as usual — no change order is made; and an older offer is never taken", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = fresh();
  const { conv } = await seedDana(f, "en");
  f.script.push(CHEAPER_CABINETS);
  await say(
    f,
    conv.id,
    "Dana wants cheaper cabinets on Q-001, twenty-five hundred",
  );
  const r = await say(f, conv.id, "what is the total on Q-001?");
  assertEquals(r.newMessages.at(-1)!.content.includes("MODEL ANSWERED"), true);
  // the offer is no longer the newest reply: the button's words are not a yes
  await say(f, conv.id, "Make change order −$1,000 for Cabinets");
  assert(
    (await f.changeOrders.listByUser("u-1")).every((c) =>
      c.deltaAmountCents !== -100_000 ||
      c.description !== "Cabinets: $3,500.00 → $2,500.00"
    ),
    "a stale offer made no change order",
  );
  await resetKv();
});

Deno.test("REQ-664 m43: a reword-only edit (no price change) on a signed quote offers nothing", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = fresh();
  const { conv } = await seedDana(f, "en");
  f.script.push({
    text: "",
    action: {
      type: "revise_quote",
      payload: {
        quoteNumber: "Q-001",
        lines: [{ match: "cabinets", description: "White shaker cabinets" }],
        remove: [],
      },
    },
  });
  const r = await say(
    f,
    conv.id,
    "call the cabinets white shaker cabinets on Q-001",
  );
  const rev = offerOf(r.newMessages.at(-1)!);
  assertEquals(rev?.kind, "locked");
  assertEquals(rev?.changeOrderOffer, undefined);
  await resetKv();
});
