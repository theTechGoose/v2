/**
 * REQ-438 (demo-loop cycle 3, M7) — a delete-invoice ask and a new-quote ask
 * became change orders, answered in English, and looped.
 *
 *   pair 6 (app in EN): "Cotización para María José Peña: cambiar la llave
 *   del fregadero de la cocina, $180 todo incluido." → the model chose
 *   change_order → "I couldn't find a quote for María José Peña, so I didn't
 *   make a new one. Which job is this change order for?". The reply
 *   "No es change order, es una cotización NUEVA…" read as a change-order
 *   request, the model's create_quote was coerced into a change order with no
 *   customer → "Which customer's job is this change order for?" — a loop.
 *
 *   pair 1 (app in ES): "No, el trabajo es solo de $180. Borra la factura
 *   repetida INV-001 por favor." → the model chose change_order → "¿Cuánto
 *   debe sumar Eliminar factura INV-001 a Q-001…? … ("agrega … $1,250") o el
 *   nuevo total ("cambia Q-001 a $19,750")".
 */
import { assert, assertEquals } from "#std/assert";
import { HandleChatMessage } from "./mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { StubLLMClient } from "@agents/domain/business/llm/implementations/stub/mod.ts";
import type { LLMResponse } from "@agents/domain/business/llm/base/mod.ts";
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
import { t } from "@core/i18n/mod.ts";
import { ChangeOrderStore } from "@paperwork/domain/data/change-order-store/mod.ts";
import type { SendChangeOrderAlert } from "@paperwork/domain/coordinators/send-change-order-alert/mod.ts";
import { ApplyChatChangeOrder } from "@agents/domain/coordinators/apply-chat-change-order/mod.ts";
import { ReviseQuote } from "@agents/domain/coordinators/revise-quote/mod.ts";

const U = "u-438";

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
  const script: LLMResponse[] = [];
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

// ---- pair 6: a Spanish new-quote request, app in English ------------------

const NEW_QUOTE_ES =
  "Cotización para María José Peña: cambiar la llave del fregadero de la cocina, $180 todo incluido.";
const DENIAL_ES =
  "No es change order, es una cotización NUEVA para María José Peña, $180.";

/** What pair 6's model did with the first message. */
const MODEL_CHANGE_ORDER: LLMResponse = {
  text: "",
  action: {
    type: "change_order",
    payload: {
      customerName: "María José Peña",
      description: "Cambio de llave del fregadero de la cocina",
      deltaAmountCents: 18_000,
    },
  },
};
const MODEL_CREATE_QUOTE: LLMResponse = {
  text: "",
  action: {
    type: "create_quote",
    payload: {
      summary: "Cambio de llave de fregadero de cocina — María José Peña",
      lineItems: [{
        description: "Cambio de llave de fregadero de cocina",
        amountCents: 18_000,
      }],
    },
  },
};

Deno.test("REQ-438 M7: the demo's Spanish new-quote request drafts the $180 quote even when the model reaches for change_order — no change-order dead end", async () => {
  const f = await setup("en");
  f.script.push(MODEL_CHANGE_ORDER);
  const conv = await f.conversations.create({ userId: U });
  const r = await say(f, conv.id, NEW_QUOTE_ES);

  const all = await f.quotes.listByUser(U);
  assertEquals(all.length, 1, "a draft quote is made");
  assertEquals(all[0].estimatedTotal, 18_000);
  assertEquals(all[0].lineItems.map((l) => l.price), [18_000]);
  const out = texts(r);
  assert(!/change order|orden de cambio/i.test(out), out);
  assert(
    r.newMessages.some((m) => m.kind === "action_card"),
    "the draft's quote card is shown",
  );
  await resetKv();
});

Deno.test("REQ-438 M7: 'No es change order, es una cotización NUEVA…' is not a change order — the model's create_quote drafts the quote", async () => {
  const f = await setup("en");
  f.script.push(MODEL_CREATE_QUOTE);
  const conv = await f.conversations.create({ userId: U });
  const r = await say(f, conv.id, DENIAL_ES);

  assertEquals(f.calls.length, 1, "the model read it");
  const all = await f.quotes.listByUser(U);
  assertEquals(all.length, 1, "a draft quote is made");
  assertEquals(all[0].estimatedTotal, 18_000);
  const out = texts(r);
  assert(!out.includes("Which customer's job"), out);
  assert(!/change order|orden de cambio/i.test(out), out);
  await resetKv();
});

Deno.test("REQ-438 M7: a create_quote on a change-order request for a customer with NO quote is not coerced into a change order", async () => {
  const f = await setup("en");
  f.script.push({
    text: "",
    action: {
      type: "create_quote",
      payload: {
        summary: "Deck stain — Pedro",
        lineItems: [{ description: "Deck stain", amountCents: 90_000 }],
      },
    },
  });
  const conv = await f.conversations.create({ userId: U });
  // the parser reads a change order for Pedro, but not what or how much
  const r = await say(
    f,
    conv.id,
    "Change order for Pedro, he wants the deck stained, nine hundred",
  );
  const all = await f.quotes.listByUser(U);
  assertEquals(all.length, 1, "the model's draft stands");
  assertEquals(all[0].estimatedTotal, 90_000);
  assert(!texts(r).includes("Which customer's job"), texts(r));
  await resetKv();
});

Deno.test("REQ-438 M7: replies follow the language the contractor TYPED — Spanish on an English app, English on a Spanish one", async () => {
  {
    const f = await setup("en");
    const conv = await f.conversations.create({ userId: U });
    // parsed in code (who, what, how much); nobody called Pedro has a quote
    const r = await say(
      f,
      conv.id,
      "Orden de cambio para Pedro: agrega limpieza del refri $40",
    );
    assertEquals(
      r.newMessages.at(-1)!.content,
      t("es", "chatCoordinator.changeOrder.none", { name: "Pedro" }),
    );
  }
  {
    const f = await setup("es");
    const conv = await f.conversations.create({ userId: U });
    const r = await say(
      f,
      conv.id,
      "Change order for Pedro: add fridge cleaning $40",
    );
    assertEquals(
      r.newMessages.at(-1)!.content,
      t("en", "chatCoordinator.changeOrder.none", { name: "Pedro" }),
    );
  }
  {
    // nothing to tell from → the app language
    const f = await setup("es");
    f.script.push({ text: "" });
    const conv = await f.conversations.create({ userId: U });
    const r = await say(f, conv.id, "ok");
    assertEquals(
      r.newMessages.at(-1)!.content,
      t("es", "chatCoordinator.noActionFallback"),
    );
  }
  await resetKv();
});

// ---- pair 1: "Borra la factura repetida INV-001" --------------------------

/** Ana Pérez, Q-001 signed at $180, INV-001 scheduled for it. */
async function seedAna(f: F, invoiceStatus: "draft" | "sent" | "paid") {
  const ana = await f.customers.create(U, { name: "Ana Pérez" });
  const quote = await f.quotes.create(U, {
    summary: "Corte de césped y limpieza",
    jobName: "Corte de césped y limpieza",
    customerId: ana.id,
    lineItems: [{
      description: "Corte de césped y limpieza",
      quantity: 1,
      unit: "ea",
      price: 18_000,
    }],
    estimatedTotal: 18_000,
  });
  const now = new Date().toISOString();
  await f.quotes.update(quote.id, U, {
    status: "accepted",
    sentAt: now,
    acceptedAt: now,
  });
  const inv = await f.invoices.create(U, {
    quoteId: quote.id,
    customerId: ana.id,
    amount: 18_000,
    status: invoiceStatus,
  } as never);
  const conv = await f.conversations.create({ userId: U });
  await f.conversations.update(conv.id, {
    quoteId: quote.id,
    currentPhase: "terms",
  } as never);
  return { ana, quote, inv, conv };
}

const DELETE_ES =
  "No, el trabajo es solo de $180. Borra la factura repetida INV-001 por favor.";

/** What pair 1's model did with it. */
const MODEL_DELETE_AS_CO: LLMResponse = {
  text: "",
  action: {
    type: "change_order",
    payload: {
      quoteNumber: "Q-001",
      description: "Eliminar factura INV-001",
      deltaAmountCents: 0,
    },
  },
};

Deno.test("REQ-438 M7: 'Borra la factura repetida INV-001' says how to delete INV-001 — no change order, nothing written, no $1,250 / $19,750", async () => {
  const f = await setup("es");
  const { quote, inv } = await seedAna(f, "draft");
  assertEquals(inv.number, "INV-001");
  f.script.push(MODEL_DELETE_AS_CO);
  const conv = (await f.conversations.listByUser(U))[0];
  const r = await say(f, conv.id, DELETE_ES);

  assertEquals(f.calls.length, 0, "answered in code, not by the model");
  assertEquals(await f.changeOrders.listByUser(U), []);
  const q = await f.quotes.getOwned(quote.id, U);
  assertEquals(q.pendingRevision ?? undefined, undefined);
  assertEquals((await f.invoices.listByUser(U)).length, 1, "nothing deleted");
  const out = r.newMessages.at(-1)!.content;
  assert(out.includes("INV-001"), out);
  assert(out.includes(t("es", "invoicesPage.detail.deleteBtn")), out);
  assert(out.includes(t("es", "nav.invoices")), out);
  assert(!out.includes("$1,250") && !out.includes("$19,750"), out);
  assert(!/orden de cambio|¿Cuánto debe sumar/i.test(out), out);
  await resetKv();
});

Deno.test("REQ-438 M7: 'Delete invoice INV-001' in English — the way to delete it, in English", async () => {
  const f = await setup("es");
  await seedAna(f, "sent");
  f.script.push(MODEL_DELETE_AS_CO);
  const conv = (await f.conversations.listByUser(U))[0];
  const r = await say(
    f,
    conv.id,
    "Please delete the duplicate invoice INV-001",
  );
  assertEquals(f.calls.length, 0);
  const out = r.newMessages.at(-1)!.content;
  assert(out.includes("INV-001"), out);
  assert(out.includes(t("en", "invoicesPage.detail.deleteBtn")), out);
  await resetKv();
});

Deno.test("REQ-438 M7: a PAID invoice can't be deleted — the reply says it stays on the record", async () => {
  const f = await setup("es");
  await seedAna(f, "paid");
  const conv = (await f.conversations.listByUser(U))[0];
  const r = await say(f, conv.id, DELETE_ES);
  assertEquals(f.calls.length, 0);
  const out = r.newMessages.at(-1)!.content;
  assertEquals(
    out,
    t("es", "chatCoordinator.invoiceRemoval.paid", { number: "INV-001" }),
  );
  await resetKv();
});

Deno.test("REQ-438 M7: an unknown invoice number says so, and how to delete one", async () => {
  const f = await setup("en");
  await seedAna(f, "draft");
  const conv = (await f.conversations.listByUser(U))[0];
  const r = await say(f, conv.id, "delete invoice INV-077");
  assertEquals(f.calls.length, 0);
  const out = r.newMessages.at(-1)!.content;
  assert(out.includes("INV-077"), out);
  assert(out.includes(t("en", "invoicesPage.detail.deleteBtn")), out);
  await resetKv();
});

// ---- askAmount: the examples come from the job ----------------------------

Deno.test("REQ-438 M7: the change-order 'how much?' question builds its examples from the job's own amounts", async () => {
  const f = await setup("es");
  const { quote } = await seedAna(f, "draft");
  // the model's delta fits no dollar amount typed → the question
  f.script.push({
    text: "",
    action: {
      type: "change_order",
      payload: {
        quoteNumber: "Q-001",
        description: "Poda de setos",
        deltaAmountCents: 99_900,
      },
    },
  });
  const conv = (await f.conversations.listByUser(U))[0];
  const r = await say(
    f,
    conv.id,
    "Ana también quiere poda de setos, son $180 más",
  );
  assertEquals(f.calls.length, 1);
  const out = r.newMessages.at(-1)!.content;
  assertEquals(
    (r.newMessages.at(-1)!.payload as { changeOrder?: { kind: string } })
      ?.changeOrder?.kind,
    "needs_amount",
  );
  assert(!out.includes("$1,250") && !out.includes("$19,750"), out);
  assert(out.includes("$180"), out);
  assert(out.includes("$360"), out);
  assertEquals(
    (await f.quotes.getOwned(quote.id, U)).pendingRevision ?? undefined,
    undefined,
  );
  await resetKv();
});
