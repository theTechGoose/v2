/**
 * REQ-1056 (LOOP-007 cycle 2, q2-41) — the app was in English
 * (/login?lang=en), the owner typed Spanish in the assistant ("haz una
 * version 2 de Q-002 sin la cerca…"). The reply came back in Spanish
 * (REQ-438) and told them to tap "Publicar revisión" — but the pill under it
 * read "Open Q-002 → Publish revision" and the /quotes button they then
 * opened reads "Publish revision and notify customer". The label a reply
 * quotes must be the one on the owner's screen: the UI-language
 * quotes.ledger.publish, whatever language the sentence is in. Same for a
 * change order on an unsigned quote (chatCoordinator.changeOrder.pendingRevision).
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { t } from "@core/i18n/mod.ts";
import type { LLMAction } from "@agents/domain/business/llm/base/mod.ts";
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

const U = "u-1056";

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

/** The owner's English UI, a Spanish message. */
const say = async (f: F, conversationId: string, content: string) =>
  await f.flow.run({ userId: U, conversationId, content, uiLang: "en" });

const texts = (r: { newMessages: { role: string; content: string }[] }) =>
  r.newMessages.filter((m) => m.role === "assistant").map((m) => m.content)
    .join("\n");

/** The real /quotes button the English owner taps. */
const EN_BUTTON = t("en", "quotes.ledger.publish");
const ES_LABEL = "Publicar revisión";

/** Ana Gomez's SENT, unsigned Q-002: a fence and painting. */
async function sentQuote(f: F) {
  // Q-001 so the quote under test is Q-002, as in the run.
  await f.quotes.create(U, {
    summary: "Other job",
    lineItems: [{
      description: "Labor",
      quantity: 1,
      unit: "ea",
      price: 10_000,
    }],
    estimatedTotal: 10_000,
  } as never);
  const ana = await f.customers.create(U, { name: "Ana Gomez" });
  const q = await f.quotes.create(U, {
    summary: "Patio — Ana Gomez",
    jobName: "Patio",
    customerId: ana.id,
    lineItems: [
      {
        description: "Cerca de madera",
        quantity: 1,
        unit: "ea",
        price: 300_000,
      },
      { description: "Pintura", quantity: 1, unit: "ea", price: 80_000 },
    ],
    estimatedTotal: 380_000,
  } as never);
  const sent = await f.quotes.update(q.id, U, {
    status: "sent",
    sentAt: new Date().toISOString(),
  });
  const conv = await f.conversations.create({ userId: U, quoteId: sent.id });
  return { quote: sent, conv };
}

function assertQuotesTheVisibleButton(out: string) {
  // The sentence is Spanish (REQ-438 holds)…
  assert(/Versión 2/.test(out), `reply is Spanish:\n${out}`);
  // …but the label it quotes is the English button on screen.
  assert(
    !out.includes(ES_LABEL),
    `the Spanish reply quotes "${ES_LABEL}", a label nowhere on the English screen (pill: "${
      t("en", "asstChat.openQuotePublish", { number: "Q-002" })
    }", /quotes button: "${EN_BUTTON}"):\n${out}`,
  );
  assertStringIncludes(out, EN_BUTTON);
}

Deno.test("REQ-1056 q2-41: English UI, Spanish 'haz una version 2 de Q-002 sin la cerca' on a sent quote — the Spanish reply quotes the English /quotes button, never 'Publicar revisión'", async () => {
  const f = await setup();
  const { quote, conv } = await sentQuote(f);
  assertEquals(quote.number, "Q-002");
  const REVISE: LLMAction = {
    type: "revise_quote",
    payload: { quoteNumber: "Q-002", lines: [], remove: ["Cerca de madera"] },
  } as LLMAction;
  f.script.push({ text: "", action: REVISE } as never);
  const r = await say(
    f,
    conv.id,
    "haz una version 2 de Q-002 sin la cerca, solo la pintura por favor",
  );
  const pending = (await f.quotes.getOwned(quote.id, U)).pendingRevision;
  assert(pending, `a Version 2 is waiting:\n${texts(r)}`);
  assertQuotesTheVisibleButton(texts(r));
});

Deno.test("REQ-1056 q2-41: English UI, Spanish change order on a sent, unsigned quote — the 'waiting as Version 2' reply quotes the English /quotes button, never 'Publicar revisión'", async () => {
  const f = await setup();
  const { quote, conv } = await sentQuote(f);
  const CO: LLMAction = {
    type: "change_order",
    payload: {
      quoteNumber: "Q-002",
      description: "Puerta de jardín",
      deltaAmountCents: 45_000,
    },
  } as LLMAction;
  f.script.push({ text: "", action: CO } as never);
  const r = await say(
    f,
    conv.id,
    "agrega una puerta de jardín por $450 a la cotización Q-002 por favor",
  );
  const pending = (await f.quotes.getOwned(quote.id, U)).pendingRevision;
  assert(pending, `a Version 2 is waiting:\n${texts(r)}`);
  assertQuotesTheVisibleButton(texts(r));
});
