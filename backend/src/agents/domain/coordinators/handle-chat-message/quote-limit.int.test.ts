/**
 * REQ-766 (demo-loop cycle 5v2, issue m17 "Plan lists disagree with what Free allows") — Monster
 * Free's card says "Up to five quotes and contracts a month", and the verifier found nothing in
 * backend/src holding it: a Free account drafted quote after quote in the chat. Here a Free
 * account that already made five quotes this month asks the assistant for a sixth: no quote is
 * stored, no card is drawn, and the reply says the month's five are used and Monster is unlimited.
 * The stub LLM plays the model; the coordinator and the stores are real.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { t } from "@core/i18n/mod.ts";
import { HandleChatMessage } from "./mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { StubLLMClient } from "@agents/domain/business/llm/implementations/stub/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { PlanStore } from "@users/domain/data/plan-store/mod.ts";
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
import type { PlanId } from "@users/dto/plan.ts";

async function fresh(lang: "en" | "es", planId: PlanId) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const kv = await getKv();
  const now = new Date().toISOString();
  await kv.set(["user", "u-1"], {
    id: "u-1",
    phoneNumber: "+15125550166",
    name: "Linda Ruiz",
    email: "linda@test.dev",
    language: lang,
    createdAt: now,
    updatedAt: now,
  });
  await new BusinessIdentityStore().upsert("u-1", {
    businessName: "Ruiz Cleaning",
    acceptedPaymentMethods: { check: { enabled: true } },
  });
  await new BusinessAddressStore().upsert("u-1", {
    city: "Austin",
    state: "TX",
    postal: "78704",
  });
  await new PlanStore().put({
    userId: "u-1",
    planId,
    status: planId === "free" ? "free" : "active",
    chosenAt: now,
    updatedAt: now,
  });
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
  // the month's five, made before this conversation
  for (let i = 1; i <= 5; i++) {
    await quotes.create("u-1", {
      summary: `House clean ${i}`,
      lineItems: [{
        description: "Deep clean",
        quantity: 1,
        unit: "ea",
        price: 30_000,
      }],
    });
  }
  return { conversations, llm, quotes, flow };
}

const sixth = {
  text: "Here's your quote.",
  action: {
    type: "create_quote" as const,
    payload: {
      summary: "Move-out deep clean",
      lineItems: [{
        description: "Move-out deep clean, 3 bed 2 bath",
        amountCents: 45_000,
      }],
    },
  },
};

for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-766 m17 (${lang}): a Free account's sixth quote this month is not drafted; the reply says the five are used and Monster is unlimited`, async () => {
    const { conversations, llm, quotes, flow } = await fresh(lang, "free");
    try {
      llm.setScript([sixth]);
      const conv = await conversations.create({ userId: "u-1" });
      const content = lang === "es"
        ? "cotiza una limpieza profunda de mudanza, $450"
        : "quote a move-out deep clean, $450";
      const result = await flow.run({
        userId: "u-1",
        conversationId: conv.id,
        content,
      });

      assertEquals(
        (await quotes.listByUser("u-1")).length,
        5,
        "no sixth quote is stored",
      );
      assertEquals(
        result.newMessages.filter((m) => m.kind === "action_card").length,
        0,
        "no draft card",
      );
      assertEquals(
        result.conversation.quoteId,
        undefined,
        "nothing is bound to the conversation",
      );
      const reply = result.newMessages.filter((m) =>
        m.role === "assistant" && m.kind === "text"
      ).map((m) => m.content).join("\n");
      assertEquals(reply, t(lang, "chatCoordinator.quoteLimit", { limit: 5 }));
      assertStringIncludes(reply, "Monster");
      assert(!reply.includes("{"), "every placeholder is filled");
    } finally {
      await resetKv();
    }
  });
}

Deno.test("REQ-766 m17: on Monster the sixth quote this month is drafted as usual", async () => {
  const { conversations, llm, quotes, flow } = await fresh("en", "monster");
  try {
    llm.setScript([sixth]);
    const conv = await conversations.create({ userId: "u-1" });
    const result = await flow.run({
      userId: "u-1",
      conversationId: conv.id,
      content: "quote a move-out deep clean, $450",
    });
    assertEquals((await quotes.listByUser("u-1")).length, 6);
    assertEquals(
      result.newMessages.filter((m) => m.kind === "action_card").length,
      1,
    );
  } finally {
    await resetKv();
  }
});
