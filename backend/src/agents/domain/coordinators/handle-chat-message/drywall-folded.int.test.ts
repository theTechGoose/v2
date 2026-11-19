/**
 * REQ-1095 (LOOP-007 cycle 3, q3-19) — "add hallway painting $450 to Q-002"
 * on a SENT Q-002 (Pintura interior $2,300 + Reparación de drywall en la
 * cocina $380 = $2,680). The model (stubbed as the tester's turn went) sent
 * revise_quote {remove drywall, newTotalDollars 2680 — the CURRENT total} AND
 * change_order {Pintura del pasillo $450} in one turn. ReviseQuote settled to
 * the echoed $2,680 (Pintura $2,300 → $2,680, the drywall's $380 folded in),
 * the change order added $450 on top → Version 2 = $3,130; and each tool
 * pushed its own "open the quote and tap Publish revision" tip, so the reply
 * said it twice. Expected: Version 2 = $2,300 + $450 = $2,750, one tip.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { HandleChatMessage } from "./mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { StubLLMClient } from "@agents/domain/business/llm/implementations/stub/mod.ts";
import type {
  LLMAction,
  LLMRequest,
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
import { HandleWizardAnswer } from "@agents/domain/coordinators/handle-wizard-answer/mod.ts";

async function seedOnboarded(userId: string) {
  const kv = await getKv();
  const now = new Date().toISOString();
  await kv.set(["user", userId], {
    id: userId,
    phoneNumber: "+15125550106",
    name: "Rafa Castillo",
    email: "priya@test.dev",
    language: "en",
    createdAt: now,
    updatedAt: now,
  });
  await new BusinessIdentityStore().upsert(userId, {
    businessName: "Castillo Painting",
    acceptedPaymentMethods: { check: { enabled: true } },
  });
  await new BusinessAddressStore().upsert(userId, {
    city: "Austin",
    state: "TX",
    postal: "78704",
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
  const bus = new EventBus();
  const wizard = new HandleWizardAnswer(
    conversations,
    messages,
    quotes,
    customers,
    users,
    bus,
  );
  const flow = new HandleChatMessage(
    conversations,
    messages,
    quotes,
    new FileStore(),
    users,
    identity,
    new BusinessAddressStore(),
    bus,
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
    new ApplyChatChangeOrder(
      quotes,
      invoices,
      new ChangeOrderStore(),
      customers,
      {
        run: () => Promise.resolve({ ok: true }),
      } as unknown as SendChangeOrderAlert,
    ),
    new ReviseQuote(quotes, customers),
    undefined,
    customers,
    undefined,
    undefined, // REQ-583's ChatBilling
    wizard,
  );
  return { conversations, messages, llm, quotes, customers, wizard, flow };
}

type Ctx = ReturnType<typeof fresh>;

function answer(
  llm: StubLLMClient,
  res: { text: string; action?: LLMAction; actions?: LLMAction[] },
): LLMRequest[] {
  const seen: LLMRequest[] = [];
  llm.setHandler((req) => {
    seen.push(req);
    // deno-lint-ignore no-explicit-any
    return res as any;
  });
  return seen;
}

const textReplies = (
  msgs: { role: string; kind: string; content: string }[],
) => msgs.filter((m) => m.role === "assistant" && m.kind === "text");

const USER_TEXT = "add hallway painting $450 to Q-002";

async function sentQ002(ctx: Ctx) {
  await seedOnboarded("u-1");
  const jose = await ctx.customers.create("u-1", { name: "Jose Ramirez" });
  await ctx.quotes.create("u-1", {
    summary: "Otro trabajo",
    lineItems: [{
      description: "Limpieza",
      quantity: 1,
      unit: "job",
      price: 10_000,
    }],
    estimatedTotal: 10_000,
  });
  const draft = await ctx.quotes.create("u-1", {
    summary: "Pintura interior y reparación de drywall — Jose Ramirez",
    jobName: "Pintura interior y drywall",
    customerId: jose.id,
    lineItems: [
      {
        description: "Pintura interior",
        quantity: 1,
        unit: "trabajo",
        price: 230_000,
      },
      {
        description: "Reparación de drywall en la cocina",
        quantity: 1,
        unit: "trabajo",
        price: 38_000,
      },
    ],
    estimatedTotal: 268_000,
  });
  assertEquals(draft.number, "Q-002");
  await ctx.quotes.update(draft.id, "u-1", {
    status: "sent",
    sentAt: new Date().toISOString(),
  });
  const conv = await ctx.conversations.create({
    userId: "u-1",
    quoteId: draft.id,
    customerId: jose.id,
  });
  return { convId: conv.id, quoteId: draft.id };
}

Deno.test("REQ-1095 q3-19: revise_quote(remove drywall, echoed total $2,680) + change_order(hallway $450) in one turn — Version 2 is $2,750 (Pintura stays $2,300), and the reply says 'tap Publish revision' once", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  try {
    const ctx = fresh();
    const { convId, quoteId } = await sentQ002(ctx);
    const revise: LLMAction = {
      type: "revise_quote",
      payload: {
        quoteNumber: "Q-002",
        lines: [],
        remove: ["Reparación de drywall en la cocina"],
        targetTotalCents: 268_000,
      },
    };
    const hallway: LLMAction = {
      type: "change_order",
      payload: { description: "Pintura del pasillo", deltaAmountCents: 45_000 },
    };
    answer(ctx.llm, { text: "", action: revise, actions: [revise, hallway] });
    const res = await ctx.flow.run({
      userId: "u-1",
      conversationId: convId,
      content: USER_TEXT,
    });
    const reply = textReplies(res.newMessages).map((m) => m.content).join(
      "\n",
    );
    const after = await ctx.quotes.getOwned(quoteId, "u-1");
    const pending = after.pendingRevision as
      | {
        estimatedTotal?: number;
        lineItems?: { description: string; price: number }[];
      }
      | undefined;
    assertEquals(
      pending?.lineItems?.find((l) => l.description === "Pintura interior")
        ?.price,
      230_000,
      `Pintura interior must stay $2,300 — reply: ${reply}`,
    );
    assertEquals(
      pending?.estimatedTotal,
      275_000,
      `Version 2 must be $2,300 + $450 = $2,750 — reply: ${reply}`,
    );
    assert(!reply.includes("3,130"), reply);
    const tips = reply.match(/open the quote and tap/gi) ?? [];
    assertEquals(
      tips.length,
      1,
      `the publish tip must appear once — reply: ${reply}`,
    );
  } finally {
    await resetKv();
  }
});
