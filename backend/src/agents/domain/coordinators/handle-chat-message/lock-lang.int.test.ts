/**
 * REQ-710 (demo-loop cycle 5, M4): the chat's own lock ("lock it in" typed,
 * the model calls lock_quote) translated a Spanish-typed quote with the
 * REPLY language as its base — `messageLang("lock it in")` is English — so
 * the English slots got the typed Spanish verbatim, exactly as the Lock-it-in
 * button did. The typed text now names the base on this path too.
 */
import { assert, assertEquals } from "#std/assert";
import { HandleChatMessage } from "./mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { StubLLMClient } from "@agents/domain/business/llm/implementations/stub/mod.ts";
import type { LLMRequest } from "@agents/domain/business/llm/base/mod.ts";
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
import { TranslateQuote } from "@agents/domain/coordinators/translate-quote/mod.ts";
import { TranslateBullets } from "@agents/domain/coordinators/translate-bullets/mod.ts";

const EN_OF: Record<string, string> = {
  "Reparación de puerta": "door repair",
  "Reparación de puerta de cocina": "Kitchen door repair",
  "Cambio de llave del fregadero": "Kitchen sink faucet replacement",
};

/** Pair 6: the app is in English, the business is set up. */
async function seedEnglishContractor(userId: string) {
  const kv = await getKv();
  const now = new Date().toISOString();
  await kv.set(["user", userId], {
    id: userId,
    phoneNumber: "+15125550710",
    name: "Luis Ortega",
    email: "luis@test.dev",
    language: "en",
    createdAt: now,
    updatedAt: now,
  });
  await new BusinessIdentityStore().upsert(userId, {
    businessName: "Ortega Handyman Services",
    acceptedPaymentMethods: { zelle: { enabled: true, handle: "5125550108" } },
  });
  await new BusinessAddressStore().upsert(userId, {
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
    new ApplyChatChangeOrder(
      quotes,
      invoices,
      new ChangeOrderStore(),
      customers,
      alert,
    ),
    new ReviseQuote(quotes, customers),
    new TranslateQuote(quotes, new TranslateBullets(llm), users),
  );
  return { conversations, quotes, llm, flow };
}

Deno.test("REQ-710 (cycle 5, M4) 'lock it in' typed in English locks pair 6's Spanish quote with Spanish as the base — the English copy is translated", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  try {
    const fx = fresh();
    await seedEnglishContractor("u-1");
    const quote = await fx.quotes.create("u-1", {
      summary: "Reparación de puerta de cocina — Carmen Núñez",
      jobName: "Reparación de puerta",
      lineItems: [
        {
          description: "Reparación de puerta de cocina",
          quantity: 1,
          unit: "ea",
          price: 17_500,
        },
        {
          description: "Cambio de llave del fregadero",
          quantity: 1,
          unit: "ea",
          price: 17_500,
        },
      ],
      estimatedTotal: 35_000,
      status: "draft",
    }, { jobNameLang: "en" });
    const conv = await fx.conversations.create({
      userId: "u-1",
      currentPhase: "quote",
    });
    await fx.conversations.update(conv.id, { quoteId: quote.id });

    const translations: LLMRequest[] = [];
    fx.llm.setHandler((req) => {
      if (
        /You translate construction scope-of-work/.test(req.systemPrompt ?? "")
      ) {
        translations.push(req);
        const { texts } = JSON.parse(req.messages[0].content as string) as {
          texts: string[];
        };
        const toEn = /bullet lines into English/.test(req.systemPrompt ?? "");
        return {
          text: JSON.stringify({
            texts: texts.map((t) => toEn ? (EN_OF[t] ?? t) : `${t} (es)`),
          }),
        };
      }
      // the chat model locks the bound quote
      return {
        text: "Locked in.",
        action: { type: "lock_quote", payload: { quoteId: quote.id } },
      };
    });

    await fx.flow.run({
      userId: "u-1",
      conversationId: conv.id,
      content: "lock it in",
    });

    const after = await fx.quotes.getOwned(quote.id, "u-1");
    assert(after.lockedAt, "the chat locked the quote");
    assertEquals(after.lang, "es");
    assertEquals(after.jobNameByLang?.en, "Door Repair");
    assertEquals(after.lineItems.map((li) => li.descriptionByLang?.en), [
      "Kitchen door repair",
      "Kitchen sink faucet replacement",
    ]);
    assertEquals(after.lineItems.map((li) => li.descriptionByLang?.es), [
      "Reparación de puerta de cocina",
      "Cambio de llave del fregadero",
    ]);
    assert(translations.length >= 1, "the lock translated the quote");
    assert(
      translations.every((r) =>
        /bullet lines into English/.test(r.systemPrompt ?? "")
      ),
      "the typed Spanish was sent to the model to be made Spanish",
    );
  } finally {
    await resetKv();
  }
});
