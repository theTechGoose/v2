/**
 * REQ-1025 (LOOP-007 cycle 2, q2-7) — one assistant reply said "Change order
 * CO-001 added … tap Send CO-001" AND "How much should … add? … I didn't
 * change anything yet", and no Send CO-001 button was drawn. QA's message:
 * "change order for maria gonzalez master bath Q-001: she wants to add a
 * recessed shampoo niche and a frameless glass door, add $2,800".
 *
 * The parser read no description, so the model answered — with two
 * change_order calls (the niche, the door). applyEditCalls ran both: the
 * first made CO-001 (unsent), the second's amount didn't match what the user
 * typed and asked for one; the texts were joined into one reply and the
 * payload kept only the last outcome (needs_amount), so the front end's
 * liveChangeOrderSendId had no unsent change order to offer Send for.
 * The follow-up "send CO-001 to maria by email" (lowercase name) was not
 * read as a send and fell to "Got it — what would you like me to do with
 * that?".
 *
 * Every test here: one change order, a reply that does not contradict
 * itself, a payload whose changeOrder is that unsent CO (what the Send
 * button reads, REQ-652), and the lowercase follow-up sends it.
 */
import { assert, assertEquals } from "#std/assert";
import { t } from "@core/i18n/mod.ts";
import { HandleChatMessage } from "./mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { StubLLMClient } from "@agents/domain/business/llm/implementations/stub/mod.ts";
import type {
  LLMAction,
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

const QA_MESSAGE =
  "change order for maria gonzalez master bath Q-001: she wants to add a recessed shampoo niche and a frameless glass door, add $2,800";
const NOT_CHANGED = "I didn't change anything yet";

/** What the model answered in QA's run: one change_order per item. */
const NICHE: LLMAction = {
  type: "change_order",
  payload: {
    quoteNumber: "Q-001",
    description: "Recessed shampoo niche",
    deltaAmountCents: 280_000,
  },
};
const DOOR: LLMAction = {
  type: "change_order",
  payload: {
    quoteNumber: "Q-001",
    description: "Frameless glass door",
    deltaAmountCents: 140_000,
  },
};

async function seedOnboarded(userId: string) {
  const kv = await getKv();
  const now = new Date().toISOString();
  await kv.set(["user", userId], {
    id: userId,
    phoneNumber: "+15125550000",
    name: "Test Contractor",
    email: "me@test.dev",
    createdAt: now,
    updatedAt: now,
  });
  await new BusinessIdentityStore().upsert(userId, {
    businessName: "Test LLC",
    acceptedPaymentMethods: { venmo: { enabled: true, handle: "@test" } },
  });
  await new BusinessAddressStore().upsert(userId, {
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
  const users = new UserStore();
  const identity = new BusinessIdentityStore();
  const email = new EmailService();
  email.send = () => Promise.resolve({ ok: true, reason: "test_capture" });
  const changeOrders = new ChangeOrderStore();
  // The customer alert (the /co email + text) is captured, not sent.
  const alerted: string[] = [];
  const alert = {
    run: (id: string) => {
      alerted.push(id);
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
    new SendPaperworkEmail(
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
    ),
    llm,
    new ApplyChatChangeOrder(quotes, invoices, changeOrders, customers, alert),
    new ReviseQuote(quotes, customers),
    undefined,
    customers,
  );
  return {
    conversations,
    llm,
    quotes,
    invoices,
    customers,
    changeOrders,
    alerted,
    flow,
  };
}

/** Maria Gonzalez's signed master bath Q-001 ($18,000) with its invoice. */
async function seedSignedMasterBath(f: ReturnType<typeof fresh>) {
  await seedOnboarded("u-1");
  const maria = await f.customers.create("u-1", {
    name: "Maria Gonzalez",
    email: "maria@example.com",
  });
  const quote = await f.quotes.create("u-1", {
    summary: "Master bath remodel — Maria Gonzalez",
    jobName: "Master bath remodel",
    customerId: maria.id,
    lineItems: [{
      description: "Master bath remodel",
      quantity: 1,
      unit: "ea",
      price: 1_800_000,
    }],
    estimatedTotal: 1_800_000,
  });
  const now = new Date().toISOString();
  const signed = await f.quotes.update(quote.id, "u-1", {
    status: "accepted",
    sentAt: now,
    acceptedAt: now,
  });
  const inv = await f.invoices.create("u-1", {
    quoteId: quote.id,
    customerId: maria.id,
    amount: 1_800_000,
    status: "sent",
  } as never);
  return { maria, quote: signed, inv };
}

/** The model makes the two change_order calls on the first turn it sees,
 *  then takes no action (as in QA's run) on any later turn. */
function modelSplitsTheChange(llm: StubLLMClient): LLMRequest[] {
  const seen: LLMRequest[] = [];
  llm.setHandler((req) => {
    seen.push(req);
    if (seen.length === 1) {
      return { text: "", action: NICHE, actions: [NICHE, DOOR] } as
        & LLMResponse
        & { actions: LLMAction[] };
    }
    return { text: "" } as LLMResponse;
  });
  return seen;
}

type Outcome = {
  kind?: string;
  sent?: boolean;
  changeOrderId?: string;
  changeOrderNumber?: string;
};

async function assertOneUnsentChangeOrderOffered(
  f: ReturnType<typeof fresh>,
  invId: string,
  reply: { content: string; payload?: unknown },
) {
  const cos = await f.changeOrders.listByInvoice("u-1", invId);
  assertEquals(cos.length, 1, "exactly one change order for the message");
  assertEquals(f.alerted, [], "nothing sent to Maria before the owner says so");
  assert(
    !reply.content.includes(NOT_CHANGED),
    `the reply both made ${
      cos[0].number
    } and said nothing changed: ${reply.content}`,
  );
  assert(
    !/How much should/i.test(reply.content),
    `the reply asks for an amount after making the change order: ${reply.content}`,
  );
  const outcome = (reply.payload as { changeOrder?: Outcome })?.changeOrder;
  // what front-end/lib/chat-quote-link.ts liveChangeOrderSendId reads to
  // draw the "Send CO-001" button the reply text promises
  assertEquals(
    { kind: outcome?.kind, sent: outcome?.sent, id: outcome?.changeOrderId },
    { kind: "change_order", sent: false, id: cos[0].id },
    `payload.changeOrder must be the unsent ${cos[0].number} (got ${
      JSON.stringify(outcome)
    })`,
  );
  if (reply.content.includes(`Send ${cos[0].number}`)) {
    assertEquals(outcome?.changeOrderNumber, cos[0].number);
  }
  return cos[0];
}

Deno.test("REQ-1025 q2-7: QA's master bath change order — the model's two change_order calls make ONE unsent CO-001, the reply never says 'I didn't change anything yet', the payload offers Send CO-001, and 'send CO-001 to maria by email' sends it", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = fresh();
  const { inv } = await seedSignedMasterBath(f);
  modelSplitsTheChange(f.llm);
  const conv = await f.conversations.create({ userId: "u-1" });

  const first = await f.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: QA_MESSAGE,
  });
  const replies = first.newMessages.filter((m) => m.role === "assistant");
  const reply = replies[replies.length - 1];
  const co = await assertOneUnsentChangeOrderOffered(f, inv.id, reply);
  assertEquals(co.deltaAmountCents, 280_000, "the $2,800 the owner typed");

  const second = await f.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: `send ${co.number} to maria by email`,
  });
  const sendReply = second.newMessages[second.newMessages.length - 1];
  assert(
    sendReply.content !== t("en", "chatCoordinator.noActionFallback"),
    `the send fell to the no-action fallback: ${sendReply.content}`,
  );
  assertEquals(
    f.alerted,
    [co.id],
    `${co.number} is sent to Maria (the /co email)`,
  );
  assertEquals(
    (await f.changeOrders.listByInvoice("u-1", inv.id)).length,
    1,
    "no second change order",
  );
  await resetKv();
});

Deno.test("REQ-1025 q2-7: on Maria's bound thread, two change_order calls in one turn (niche $2,800 typed, door at a made-up amount) still give one unsent change order and a payload that offers Send", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = fresh();
  const { quote, inv } = await seedSignedMasterBath(f);
  modelSplitsTheChange(f.llm);
  // bound to Q-001, and no "change order" words — only the model can read it
  const conv = await f.conversations.create({
    userId: "u-1",
    quoteId: quote.id,
  });
  const res = await f.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content:
      "maria also wants a recessed shampoo niche and a frameless glass door, $2,800 for both",
  });
  const replies = res.newMessages.filter((m) => m.role === "assistant");
  await assertOneUnsentChangeOrderOffered(
    f,
    inv.id,
    replies[replies.length - 1],
  );
  await resetKv();
});

// ---------------------------------------------------------------------------
// REQ-1098 = REQ-1025 AMENDMENT (LOOP-007 cycle 3, q3-23): on the Q-001
// conversation, "maria wants to add painting the detached garage $1,150 and
// replacing 3 rotten fence boards $95.50. make a change order and send it to
// her" made AND SENT CO-001 ($1,150) and CO-002 ($95.50): two customer
// emails, two owner alerts, two approvals; the chat linked only CO-002.
// ---------------------------------------------------------------------------
const Q323_MESSAGE =
  "maria wants to add painting the detached garage $1,150 and replacing 3 rotten fence boards $95.50. make a change order and send it to her";
const GARAGE: LLMAction = {
  type: "change_order",
  payload: {
    customerName: "Maria",
    quoteNumber: "Q-001",
    description: "Painting the detached garage",
    deltaAmountCents: 115_000,
  },
};
const BOARDS: LLMAction = {
  type: "change_order",
  payload: {
    customerName: "Maria",
    quoteNumber: "Q-001",
    description: "Replacing 3 rotten fence boards",
    deltaAmountCents: 9_550,
  },
};

Deno.test("REQ-1098 (REQ-1025 AMENDMENT q3-23): 'add garage $1,150 and fence boards $95.50, make a change order and send it to her' on Q-001 makes and sends ONE change order at $1,245.50, and the payload names it", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = fresh();
  const { quote, inv } = await seedSignedMasterBath(f);
  // the model answers as in QA's run: one change_order per item
  let calls = 0;
  f.llm.setHandler(() => {
    calls++;
    if (calls === 1) {
      return { text: "", action: GARAGE, actions: [GARAGE, BOARDS] } as
        & LLMResponse
        & { actions: LLMAction[] };
    }
    return { text: "" } as LLMResponse;
  });
  const conv = await f.conversations.create({
    userId: "u-1",
    quoteId: quote.id,
  });
  const res = await f.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: Q323_MESSAGE,
  });
  const replies = res.newMessages.filter((m) => m.role === "assistant");
  const reply = replies[replies.length - 1];

  const cos = await f.changeOrders.listByInvoice("u-1", inv.id);
  assertEquals(
    cos.map((c) => [c.number, c.deltaAmountCents]),
    [[cos[0]?.number, 124_550]],
    `one change order for $1,150 + $95.50, not ${cos.length} (reply: ${reply.content})`,
  );
  assert(
    /detached garage/i.test(cos[0].description ?? "") &&
      /fence boards/i.test(cos[0].description ?? ""),
    `the change order names both items (got ${cos[0].description})`,
  );
  // SendChangeOrderAlert = the customer's /co email + text and the owner's alert
  assertEquals(f.alerted, [cos[0].id], "Maria is sent ONE change order");
  const outcome = (reply.payload as { changeOrder?: Outcome })?.changeOrder;
  assertEquals(
    { kind: outcome?.kind, sent: outcome?.sent, id: outcome?.changeOrderId },
    { kind: "change_order", sent: true, id: cos[0].id },
    `payload.changeOrder must be that sent change order (got ${
      JSON.stringify(outcome)
    })`,
  );
  await resetKv();
});
