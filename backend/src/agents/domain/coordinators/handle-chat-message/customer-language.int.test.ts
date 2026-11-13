/**
 * REQ-715 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 5 backlog c4-M34 "No per-client language preference;
 * assistant doesn't remember it": pair 6 typed "Quote para Carmen Ruiz: fix
 * leaky faucet en la cocina y colgar 2 puertas interiores, $450 todo
 * incluido. Ella habla español." — the quote was drafted, and the Spanish was
 * forgotten: every send had to be re-picked by hand.
 *
 * create_quote now carries `customerLanguage` when the user states it. The
 * coordinator saves it on the customer the quote is for; when no customer is
 * known yet it waits on the conversation and lands on the customer the
 * "Who is this for?" step binds.
 */
import { assertEquals } from "#std/assert";
import { HandleChatMessage } from "./mod.ts";
import { HandleWizardAnswer } from "@agents/domain/coordinators/handle-wizard-answer/mod.ts";
import { TransitionToTerms } from "@agents/domain/coordinators/transition-to-terms/mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { StubLLMClient } from "@agents/domain/business/llm/implementations/stub/mod.ts";
import type { LLMAction } from "@agents/domain/business/llm/base/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { ChangeOrderStore } from "@paperwork/domain/data/change-order-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { BusinessAddressStore } from "@profile/domain/data/business-address-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { FileStore } from "@files/domain/data/file-store/mod.ts";
import { SendPaperworkEmail } from "@paperwork/domain/coordinators/send-paperwork-email/mod.ts";
import type { SendChangeOrderAlert } from "@paperwork/domain/coordinators/send-change-order-alert/mod.ts";
import { EmailService } from "@communication/domain/data/email-service/mod.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { ConversationStore as CommConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore as CommMessageStore } from "@communication/domain/data/message-store/mod.ts";
import { ApplyChatChangeOrder } from "@agents/domain/coordinators/apply-chat-change-order/mod.ts";
import { ReviseQuote } from "@agents/domain/coordinators/revise-quote/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";

const USER = "u-req715-chat";

async function seedOnboarded() {
  const kv = await getKv();
  const now = new Date().toISOString();
  await kv.set(["user", USER], {
    id: USER,
    phoneNumber: "+15125557200",
    name: "Luis Ortega",
    email: "luis@test.dev",
    language: "es",
    createdAt: now,
    updatedAt: now,
  });
  await new BusinessIdentityStore().upsert(USER, {
    businessName: "Ortega Handyman Services",
    acceptedPaymentMethods: { check: { enabled: true } },
  });
  await new BusinessAddressStore().upsert(USER, {
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
  );
  const wizard = new HandleWizardAnswer(
    conversations,
    messages,
    quotes,
    customers,
    users,
    new EventBus(),
    identity,
  );
  const terms = new TransitionToTerms(conversations, messages);
  return { conversations, llm, quotes, customers, flow, wizard, terms };
}

function draft(summary: string, customerLanguage: "en" | "es"): LLMAction {
  return {
    type: "create_quote",
    payload: {
      summary,
      lineItems: [
        {
          description: "Reparar fuga del grifo de la cocina",
          amountCents: 225_00,
        },
        { description: "Colgar 2 puertas interiores", amountCents: 225_00 },
      ],
      customerLanguage,
    },
  } as LLMAction;
}

Deno.test("REQ-715 c4-M34: 'Quote para Carmen Ruiz … Ella habla español.' — the customer the quote is for now reads Spanish", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  try {
    const ctx = fresh();
    await seedOnboarded();
    const carmen = await ctx.customers.create(USER, {
      name: "Carmen Ruiz",
      phoneNumber: "+15125557201",
    });
    ctx.llm.setScript([{
      text: "Listo, aquí está la cotización para Carmen.",
      action: draft("Cotización: grifo y 2 puertas — Carmen Ruiz", "es"),
    }]);
    const conv = await ctx.conversations.create({ userId: USER });
    await ctx.flow.run({
      userId: USER,
      conversationId: conv.id,
      content:
        "Quote para Carmen Ruiz: fix leaky faucet en la cocina y colgar 2 puertas interiores, $450 todo incluido. Ella habla español.",
    });

    const after = await ctx.customers.getOwned(carmen.id, USER) as {
      language?: string;
    };
    assertEquals(
      after.language,
      "es",
      "the assistant remembers she reads Spanish",
    );
    const bound = await ctx.conversations.get(conv.id);
    assertEquals(bound.customerId, carmen.id);
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-715 c4-M34: said before the customer exists, the language waits on the conversation and lands on the customer the 'Who is this for?' step creates", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  try {
    const ctx = fresh();
    await seedOnboarded();
    ctx.llm.setScript([{
      text: "Listo, aquí está la cotización.",
      action: draft("Cotización: grifo y 2 puertas — Ana Gómez", "es"),
    }]);
    const conv = await ctx.conversations.create({ userId: USER });
    await ctx.flow.run({
      userId: USER,
      conversationId: conv.id,
      content:
        "Cotización para Ana Gómez: grifo de la cocina y 2 puertas, $450. Ella habla español.",
    });
    const waiting = await ctx.conversations.get(conv.id) as {
      customerId?: string;
      customerLanguage?: string;
    };
    assertEquals(waiting.customerId, undefined, "no such customer yet");
    assertEquals(
      waiting.customerLanguage,
      "es",
      "the language waits on the thread",
    );

    await ctx.terms.run({ userId: USER, conversationId: conv.id });
    await ctx.wizard.run({
      userId: USER,
      conversationId: conv.id,
      stepId: "customer",
      optionId: "create_new",
      customer: { create: { name: "Ana Gómez", phoneNumber: "+15125557202" } },
    });
    const ana = (await ctx.customers.listByUser(USER))
      .find((c) => c.name === "Ana Gómez") as
        | { language?: string }
        | undefined;
    assertEquals(
      ana?.language,
      "es",
      "the customer the step created reads Spanish",
    );
  } finally {
    await resetKv();
  }
});
