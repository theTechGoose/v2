/**
 * REQ-1027 (LOOP-007 cycle 2, q2-4) — in the Q-002 chat, "jorge dijo que es
 * mucho. haz una version 2 de Q-002 sin la cerca, solo la pintura, total
 * 5,550". Q-002 is SENT, unsigned: Pintura exterior $4,200 + Reparación de
 * cerca $900 + Materiales para pintura $1,350 = $6,450. The model (stubbed
 * here exactly as the tester's turn went) sent revise_quote {Pintura exterior
 * → 555000, remove cerca}: no code read "total 5,550" (no "$"), and Version 2
 * was saved at $6,900 — $1,350 over his total, $450 over the v1 he called
 * too much. The stated total must win, or nothing is written and he is asked.
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
    language: "es",
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

const Q24_TEXT =
  "jorge dijo que es mucho. haz una version 2 de Q-002 sin la cerca, solo la pintura, total 5,550";

async function sentQ002(ctx: Ctx) {
  await seedOnboarded("u-1");
  const jorge = await ctx.customers.create("u-1", { name: "Jorge Ramírez" });
  // Q-001 — another job, so the painting quote is Q-002
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
    summary: "Pintura exterior y cerca — Jorge Ramírez",
    jobName: "Pintura exterior y cerca",
    customerId: jorge.id,
    lineItems: [
      {
        description: "Pintura exterior",
        quantity: 1,
        unit: "job",
        price: 420_000,
      },
      {
        description: "Reparación de cerca (tablas y postes)",
        quantity: 1,
        unit: "job",
        price: 90_000,
      },
      {
        description: "Materiales para pintura",
        quantity: 1,
        unit: "job",
        price: 135_000,
      },
    ],
    estimatedTotal: 645_000,
  });
  assertEquals(draft.number, "Q-002");
  await ctx.quotes.update(draft.id, "u-1", {
    status: "sent",
    sentAt: new Date().toISOString(),
  });
  const conv = await ctx.conversations.create({
    userId: "u-1",
    quoteId: draft.id,
    customerId: jorge.id,
  });
  return { convId: conv.id, quoteId: draft.id };
}

Deno.test("REQ-1027 q2-4: 'sin la cerca, solo la pintura, total 5,550' on a sent Q-002 — the model's revise_quote Pintura→$5,550 never saves a $6,900 Version 2; it lands $5,550 or asks with nothing written", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  const { convId, quoteId } = await sentQ002(ctx);
  const revise: LLMAction = {
    type: "revise_quote",
    payload: {
      quoteNumber: "Q-002",
      lines: [{ match: "Pintura exterior", amountCents: 555_000 }],
      remove: ["cerca"],
    },
  };
  answer(ctx.llm, { text: "", action: revise, actions: [revise] });
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: convId,
    content: Q24_TEXT,
  });
  const reply = textReplies(res.newMessages).map((m) => m.content).join(
    "\n",
  );
  assert(!reply.includes("6,900"), reply);
  const after = await ctx.quotes.getOwned(quoteId, "u-1");
  const pending = after.pendingRevision as
    | {
      estimatedTotal?: number;
      lineItems?: { description: string; price: number }[];
    }
    | undefined;
  if (pending) {
    assertEquals(
      pending.estimatedTotal,
      555_000,
      `Version 2 must be the $5,550 he typed — reply: ${reply}`,
    );
    assertEquals(
      pending.lineItems?.find((l) => /materiales/i.test(l.description))?.price,
      135_000,
      "Materiales para pintura stays $1,350",
    );
    assert(
      !pending.lineItems?.some((l) => /cerca/i.test(l.description)),
      "the fence is gone",
    );
  } else {
    assertStringIncludes(reply, "5,550");
    assertEquals(after.estimatedTotal, 645_000);
  }
  await resetKv();
});
