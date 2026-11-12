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
import { getKv, resetKv } from "@core/data/kv/mod.ts";
import { QuotePriceError } from "#quote-flow/quote-price-guard.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { ConversationStore as CommConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore as CommMessageStore } from "@communication/domain/data/message-store/mod.ts";
import type { SendEmailInput } from "@communication/domain/data/email-service/mod.ts";
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
  const sentEmails: SendEmailInput[] = [];
  email.send = (input: SendEmailInput) => {
    sentEmails.push(input);
    return Promise.resolve({ ok: true, reason: "test_capture" });
  };
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
    sentEmails,
    bus,
    emailer,
    flow: new LockQuote(
      conversations,
      messages,
      quotes,
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

Deno.test("lock-quote integration: REQ-234 locks the quote, appends action_card + continue_cta(toPhase=terms)", async () => {
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
    // REQ-234 (demo M3): locking is NOT sending — the quote stays a draft.
    const after = await s.quotes.get(quote.id);
    assertEquals(after.status, "draft");
    assertEquals(after.sentAt, undefined);
    assert(after.lockedAt, "lockedAt stamped");
  });
});

Deno.test("lock-quote integration: REQ-234 (demo M3) lock never sends — no sentAt, no 'sent' event, no email, card + conversation say 'locked'", async () => {
  await withKv(async () => {
    const s = fresh();
    // deno-lint-ignore no-explicit-any
    const events: any[] = [];
    s.bus.subscribe((e) => {
      events.push(e);
    });
    // A customer WITH an email bound — the case that used to email them.
    const customer = await s.customers.create("u-1", {
      name: "Acme",
      email: "ops@acme.test",
    });
    const conv = await s.conversations.create({
      userId: "u-1",
      currentPhase: "quote",
      customerId: customer.id,
    });
    const quote = await s.quotes.create("u-1", {
      summary: "Roof",
      customerId: customer.id,
      lineItems: [{ description: "x", quantity: 1, unit: "ea", price: 100 }],
      estimatedTotal: 100,
    });
    const r = await s.flow.run({
      userId: "u-1",
      conversationId: conv.id,
      quoteId: quote.id,
    });
    const after = await s.quotes.get(quote.id);
    assertEquals(after.status, "draft");
    assertEquals(after.sentAt, undefined);
    assertEquals(
      events.filter((e) => e.entityType === "quote" && e.action === "sent")
        .length,
      0,
    );
    assertEquals(s.sentEmails.length, 0);
    assertEquals(
      (r.newMessages[0].payload as { status?: string }).status,
      "locked",
    );
    assertEquals(r.conversation.quoteStatus, "locked");
    assert(
      !/sent/i.test(r.conversation.preview ?? ""),
      `preview must not say sent: ${r.conversation.preview}`,
    );
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

Deno.test("lock-quote integration: REQ-234 re-locking a quote that was already sent keeps it sent (no demotion)", async () => {
  await withKv(async () => {
    const s = fresh();
    const conv = await s.conversations.create({
      userId: "u-1",
      currentPhase: "quote",
    });
    const sentAt = new Date().toISOString();
    const quote = await s.quotes.create("u-1", {
      summary: "x",
      lineItems: [],
      status: "sent",
    });
    await s.quotes.update(quote.id, "u-1", { sentAt });
    const r = await s.flow.run({
      userId: "u-1",
      conversationId: conv.id,
      quoteId: quote.id,
    });
    const after = await s.quotes.get(quote.id);
    assertEquals(after.status, "sent");
    assertEquals(after.sentAt, sentAt);
    assertEquals(
      (r.newMessages[0].payload as { status?: string }).status,
      "sent",
    );
    assertEquals(r.conversation.quoteStatus, "sent");
    assertEquals(s.sentEmails.length, 0);
  });
});

// REQ-264 (demo M15): every document language is filled on the server when
// the quote locks, so /q?lang=en on a Spanish quote reads English.
// (Reconciled with REQ-234 on demo-fixes: lock no longer sends — the quote
// stays a draft with lockedAt; the translation still runs at lock.)
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
    // REQ-333: a Spanish contractor typed the Spanish line — Spanish is the
    // base, English the translation.
    const users = new UserStore();
    await (await getKv()).set(["user", "u-1"], {
      id: "u-1",
      phoneNumber: "+15550000264",
      language: "es",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const s = fresh(
      new TranslateQuote(new QuoteStore(), new TranslateBullets(llm), users),
    );
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
    assertEquals(after.status, "draft"); // REQ-234: locked, not sent
    assert(after.lockedAt, "lockedAt stamped");
    assertEquals(after.lineItems[0].descriptionByLang?.en, "Paint the bathroom");
    assertEquals(after.lineItems[0].description, "Pintar el baño");
  });
});

// REQ-302 (demo-loop cycle 1, B1): a quote with no price — a negative line or
// a total at or below zero — cannot be locked. The demo locked a -$500 quote;
// LockQuote never looked at the total (`fresh.estimatedTotal ?? 0`). The row
// is written straight to KV because the store now refuses such a quote too.
Deno.test("REQ-302 B1 lock-quote integration: refuses to lock a quote whose total is not above zero or that has a negative line", async () => {
  await withKv(async () => {
    const s = fresh();
    const kv = await getKv();
    const now = new Date().toISOString();
    for (
      const [id, price, total] of [
        ["q-neg", -50_000, -50_000],
        ["q-zero", 0, 0],
      ] as const
    ) {
      await kv.set(["quote", id], {
        id,
        userId: "u-1",
        summary: "Panel swap",
        lineItems: [{ description: "Panel swap", quantity: 1, unit: "ea", price }],
        estimatedTotal: total,
        status: "draft",
        createdAt: now,
        updatedAt: now,
      });
      await kv.set(["quote_by_user", "u-1", id], id);
      const conv = await s.conversations.create({
        userId: "u-1",
        currentPhase: "quote",
      });
      await assertRejects(
        () => s.flow.run({ userId: "u-1", conversationId: conv.id, quoteId: id }),
        QuotePriceError,
      );
      const after = await s.quotes.get(id);
      assertEquals(after.lockedAt, undefined, `${id} must not be locked`);
      assertEquals(
        (await s.messages.listByConversation(conv.id)).length,
        0,
        "no locked card",
      );
    }
  });
});

// REQ-333 (demo-loop cycle 1, M24): "AI silently rewords line items". An
// English contractor's typed lines were sent through the model with to:'en'
// at lock and came back normalized; the review card then showed the
// paraphrase while the locked card showed the original. The quote's own
// language is cached verbatim — the model only ever sees the OTHER language.
Deno.test("REQ-333 (M24) lock-quote keeps an English contractor's typed lines verbatim in English", async () => {
  await withKv(async () => {
    const llm = new StubLLMClient();
    const prompts: string[] = [];
    llm.setHandler((req) => {
      prompts.push(req.systemPrompt ?? "");
      const { texts } = JSON.parse(req.messages[0].content as string) as {
        texts: string[];
      };
      const toEn = /English/.test(req.systemPrompt ?? "");
      return {
        text: JSON.stringify({
          texts: texts.map((t) =>
            toEn ? `${t} (reworded)` : `${t} (en español)`
          ),
        }),
      };
    });
    const users = new UserStore();
    const me = await users.create({ phoneNumber: "+15550000335", language: "en" });
    const s = fresh(
      new TranslateQuote(new QuoteStore(), new TranslateBullets(llm), users),
    );
    const conv = await s.conversations.create({
      userId: me.id,
      currentPhase: "quote",
    });
    const quote = await s.quotes.create(me.id, {
      summary: "Bathroom remodel",
      lineItems: [
        { description: "Demo and haul-off", quantity: 1, unit: "ea", price: 90_000 },
        { description: "Plumbing fixtures", quantity: 1, unit: "ea", price: 60_000 },
      ],
      estimatedTotal: 150_000,
    });
    await s.conversations.update(conv.id, { quoteId: quote.id });

    await s.flow.run({ userId: me.id, conversationId: conv.id, quoteId: quote.id });

    const after = await s.quotes.getOwned(quote.id, me.id);
    assertEquals(after.lineItems.map((li) => li.descriptionByLang?.en), [
      "Demo and haul-off",
      "Plumbing fixtures",
    ]);
    assertEquals(after.lineItems.map((li) => li.descriptionByLang?.es), [
      "Demo and haul-off (en español)",
      "Plumbing fixtures (en español)",
    ]);
    assertEquals(after.lang, "en");
    assertEquals(prompts.length, 1, "the model is asked once — for Spanish");
    assert(!prompts.some((p) => /into English/.test(p)));
  });
});

Deno.test("REQ-435 M4 lock-quote integration: the locked action_card carries the quote's serviceAddress", async () => {
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
      serviceAddress: "4410 Avenue F Austin TX 78751",
    });
    const r = await s.flow.run({
      userId: "u-1",
      conversationId: conv.id,
      quoteId: quote.id,
    });
    assertEquals(
      (r.newMessages[0].payload as { serviceAddress?: string } | undefined)
        ?.serviceAddress,
      "4410 Avenue F Austin TX 78751",
    );
  });
});

Deno.test("lock-quote integration: REQ-465 (demo cycle 3, m37) the locked action_card carries the quote's number", async () => {
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
    assert(quote.number, "the quote is numbered at create");
    const r = await s.flow.run({
      userId: "u-1",
      conversationId: conv.id,
      quoteId: quote.id,
    });
    const card = r.newMessages[0];
    assertEquals(card.kind, "action_card");
    assertEquals(
      (card.payload as { number?: string } | undefined)?.number,
      quote.number,
    );
  });
});
