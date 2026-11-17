/**
 * REQ-651 (demo-loop cycle 5, B1) — a price stated in words never lands on
 * the quote too LOW.
 *
 * Pair 8 (fleet-7 stdout:304-318): on a $12,000 fence draft, "too high. I
 * get $55 a foot, gate is $450. break it out please" came back as a fence
 * line of $82.50 (55 × 150 as cents) — saved, total $532.50.
 * Pair 7 (fleet-6 stdout:323-331): "…heated floor in bath, 64 sqft, about
 * 1200 extra…" on a sent $18,750 quote became a $150 pending revision.
 *
 * The stub LLM replays the demo model's answers; the coordinator is real.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
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

async function seedOnboarded(userId: string) {
  const kv = await getKv();
  const now = new Date().toISOString();
  await kv.set(["user", userId], {
    id: userId,
    phoneNumber: "+15125550142",
    name: "Hank Miller",
    email: "hank@test.dev",
    language: "en",
    createdAt: now,
    updatedAt: now,
  });
  await new BusinessIdentityStore().upsert(userId, {
    businessName: "Miller Fence Co.",
    acceptedPaymentMethods: { check: { enabled: true } },
  });
  await new BusinessAddressStore().upsert(userId, {
    city: "Austin",
    state: "TX",
    postal: "78704",
  });
}

async function fresh() {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  await seedOnboarded("u-1");
  const conversations = new AgentConversationStore();
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
  const alert = {
    run: () => Promise.resolve({ ok: true }),
  } as unknown as SendChangeOrderAlert;
  const flow = new HandleChatMessage(
    conversations,
    new AgentMessageStore(),
    quotes,
    new FileStore(),
    users,
    identity,
    new BusinessAddressStore(),
    new EventBus(),
    emailer,
    llm,
    new ApplyChatChangeOrder(
      quotes,
      invoices,
      new ChangeOrderStore(),
      customers,
      alert,
    ),
    new ReviseQuote(quotes, customers),
    undefined,
    customers,
  );
  return { conversations, llm, quotes, customers, flow };
}

const replyOf = (msgs: AgentMessage[]) =>
  msgs.filter((m) => m.role === "assistant" && m.kind === "text")
    .map((m) => m.content).join("\n");
const storedTotal = (
  q: { lineItems: { price: number; quantity?: number }[] },
) => q.lineItems.reduce((s, l) => s + l.price * (l.quantity ?? 1), 0);

Deno.test("REQ-651 B1 (pair 8): 'I get $55 a foot, gate is $450' on the $12,000 fence draft saves $8,250 + $450 — never the model's $82.50 / $532.50", async () => {
  const ctx = await fresh();
  const draft = await ctx.quotes.create("u-1", {
    summary: "Cedar privacy fence installation",
    lineItems: [{
      description:
        "Cedar privacy fence installation (150 ft, 6 ft high) with one gate",
      quantity: 1,
      unit: "ea",
      price: 1_200_000,
    }],
    estimatedTotal: 1_200_000,
    status: "draft",
  });
  const conv = await ctx.conversations.create({
    userId: "u-1",
    quoteId: draft.id,
  });
  const modelSlip: LLMResponse = {
    text: "",
    action: {
      type: "create_quote",
      payload: {
        summary: "Cedar privacy fence installation",
        lineItems: [
          {
            description: "Cedar privacy fence installation (150 ft, 6 ft high)",
            amountCents: 8_250,
          },
          { description: "Cedar gate installation", amountCents: 45_000 },
        ],
      },
    },
  };
  ctx.llm.setHandler(() => modelSlip);
  const result = await ctx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "too high. I get $55 a foot, gate is $450. break it out please",
  });
  const stored = await ctx.quotes.getOwned(draft.id, "u-1");
  assertEquals(
    stored.lineItems.map((l) => l.price * (l.quantity ?? 1)),
    [825_000, 45_000],
  );
  assertEquals(storedTotal(stored), 870_000);
  const reply = replyOf(result.newMessages);
  assert(!reply.includes("532.50"), reply);
  assert(!reply.includes("82.50"), reply);
  await resetKv();
});

Deno.test("REQ-651 B1 (pair 7): 'about 1200 extra' answered with a $150 change_order on the sent $18,750 quote writes nothing and asks how much", async () => {
  const ctx = await fresh();
  const hendersons = await ctx.customers.create("u-1", { name: "Hendersons" });
  const quote = await ctx.quotes.create("u-1", {
    summary: "Master Bath & Kitchen — Hendersons",
    jobName: "Master Bath & Kitchen",
    customerId: hendersons.id,
    lineItems: [{
      description: "Master bath and kitchen remodel",
      quantity: 1,
      unit: "ea",
      price: 1_875_000,
    }],
    estimatedTotal: 1_875_000,
    status: "sent",
  });
  ctx.llm.setHandler(() => ({
    text: "",
    action: {
      type: "change_order",
      payload: {
        customerName: "Hendersons",
        description: "Heated floor in bath, 64 sqft",
        deltaAmountCents: 15_000,
      },
    },
  }));
  const conv = await ctx.conversations.create({ userId: "u-1" });
  const result = await ctx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content:
      "also add change order for the Hendersons: heated floor in bath, 64 sqft, about 1200 extra.",
  });
  const stored = await ctx.quotes.getOwned(quote.id, "u-1");
  assertEquals(
    stored.pendingRevision,
    undefined,
    "the $150 must not be written",
  );
  assertEquals(stored.estimatedTotal, 1_875_000);
  const reply = replyOf(result.newMessages);
  assert(!reply.includes("$150"), reply);
  assertStringIncludes(reply, "How much should");
  assertStringIncludes(reply, "$1,200");
  await resetKv();
});
