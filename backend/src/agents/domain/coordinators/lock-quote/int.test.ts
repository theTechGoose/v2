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
import type { SendEmailInput } from "@communication/domain/data/email-service/mod.ts";

function fresh() {
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
