import { assert, assertEquals, assertRejects } from "#std/assert";
import { LockQuote } from "./mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { SendPaperworkEmail } from "@paperwork/domain/coordinators/send-paperwork-email/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { EmailService } from "@communication/domain/data/email-service/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { ConversationStore as CommConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore as CommMessageStore } from "@communication/domain/data/message-store/mod.ts";
import { TranslateQuote } from "@agents/domain/coordinators/translate-quote/mod.ts";
import { TranslateBullets } from "@agents/domain/coordinators/translate-bullets/mod.ts";
import { StubLLMClient } from "@agents/domain/business/llm/implementations/stub/mod.ts";

function fresh(translator?: TranslateQuote) {
  const conversations = new AgentConversationStore();
  const messages = new AgentMessageStore();
  const quotes = new QuoteStore();
  const invoices = new InvoiceStore();
  const customers = new CustomerStore();
  const email = new EmailService();
  const bus = new EventBus();
  const emailer = new SendPaperworkEmail(
    quotes,
    invoices,
    customers,
    new UserStore(),
    new BusinessIdentityStore(),
    email,
    new LogPaperworkMessage(
      new CommConversationStore(),
      new CommMessageStore(),
    ),
  );
  return {
    conversations,
    messages,
    quotes,
    invoices,
    customers,
    email,
    bus,
    emailer,
    flow: new LockQuote(
      conversations,
      messages,
      quotes,
      bus,
      emailer,
      new UserStore(),
      translator,
    ),
  };
}

async function withKv<T>(fn: () => Promise<T>): Promise<T> {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  try {
    return await fn();
  } finally {
    await resetKv();
  }
}

Deno.test("lock-quote integration: flips quote→sent, appends action_card + continue_cta(toPhase=terms)", async () => {
  await withKv(async () => {
    const s = fresh();
    const conv = await s.conversations.create({
      userId: "u-1",
      currentPhase: "quote",
    });
    const quote = await s.quotes.create("u-1", {
      summary: "Roof",
      lineItems: [{ description: "x", quantity: 1, unit: "ea", price: 100 }],
      estimatedTotal: 100,
    });
    const r = await s.flow.run({
      userId: "u-1",
      conversationId: conv.id,
      quoteId: quote.id,
    });
    assertEquals(r.newMessages.length, 2);
    assertEquals(r.newMessages[0].kind, "action_card");
    assertEquals(r.newMessages[1].kind, "continue_cta");
    assertEquals(
      (r.newMessages[1].payload as { toPhase?: string } | undefined)?.toPhase,
      "terms",
    );
    const after = await s.quotes.get(quote.id);
    assertEquals(after.status, "sent");
  });
});

Deno.test("lock-quote integration: idempotent on already-sent quote", async () => {
  await withKv(async () => {
    const s = fresh();
    const conv = await s.conversations.create({
      userId: "u-1",
      currentPhase: "quote",
    });
    const quote = await s.quotes.create("u-1", {
      summary: "x",
      lineItems: [],
      status: "sent",
    });
    const r = await s.flow.run({
      userId: "u-1",
      conversationId: conv.id,
      quoteId: quote.id,
    });
    assert(r.conversation.quoteId === quote.id);
    const after = await s.quotes.get(quote.id);
    assertEquals(after.status, "sent");
  });
});

Deno.test("lock-quote integration: cross-owner is forbidden", async () => {
  await withKv(async () => {
    const s = fresh();
    const convB = await s.conversations.create({
      userId: "u-B",
      currentPhase: "quote",
    });
    const quoteA = await s.quotes.create("u-A", {
      summary: "x",
      lineItems: [],
    });
    await assertRejects(
      () =>
        s.flow.run({
          userId: "u-B",
          conversationId: convB.id,
          quoteId: quoteA.id,
        }),
    );
  });
});

Deno.test("lock-quote integration: emits quote:sent on the bus", async () => {
  await withKv(async () => {
    const s = fresh();
    // deno-lint-ignore no-explicit-any
    const events: any[] = [];
    s.bus.subscribe((e) => {
      events.push(e);
    });
    const conv = await s.conversations.create({
      userId: "u-1",
      currentPhase: "quote",
    });
    const quote = await s.quotes.create("u-1", { summary: "x", lineItems: [] });
    await s.flow.run({
      userId: "u-1",
      conversationId: conv.id,
      quoteId: quote.id,
    });
    const sent = events.find((e) =>
      e.entityType === "quote" && e.action === "sent"
    );
    assert(sent);
  });
});

// REQ-264 (demo M15): locking a quote sends it — every document language is
// filled on the server first, so /q?lang=en on a Spanish quote reads English.
Deno.test("REQ-264 (M15) lock-quote fills the English line items of a Spanish quote", async () => {
  await withKv(async () => {
    const llm = new StubLLMClient();
    llm.setHandler((req) => {
      const { texts } = JSON.parse(req.messages[0].content as string) as {
        texts: string[];
      };
      const toEn = /English/.test(req.systemPrompt ?? "");
      return {
        text: JSON.stringify({
          texts: texts.map((t) =>
            toEn && t === "Pintar el baño" ? "Paint the bathroom" : t
          ),
        }),
      };
    });
    const s = fresh(new TranslateQuote(new QuoteStore(), new TranslateBullets(llm)));
    const conv = await s.conversations.create({
      userId: "u-1",
      currentPhase: "quote",
    });
    const quote = await s.quotes.create("u-1", {
      summary: "Baño",
      lineItems: [{
        description: "Pintar el baño",
        quantity: 1,
        unit: "ea",
        price: 45_000,
      }],
      estimatedTotal: 45_000,
    });
    await s.conversations.update(conv.id, { quoteId: quote.id });

    await s.flow.run({
      userId: "u-1",
      conversationId: conv.id,
      quoteId: quote.id,
    });

    const after = await s.quotes.getOwned(quote.id, "u-1");
    assertEquals(after.status, "sent");
    assertEquals(after.lineItems[0].descriptionByLang?.en, "Paint the bathroom");
    assertEquals(after.lineItems[0].description, "Pintar el baño");
  });
});
