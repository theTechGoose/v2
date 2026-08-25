import { assert, assertEquals, assertRejects } from "#std/assert";
import { SendInvoice } from "./mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
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

function fresh() {
  const conversations = new AgentConversationStore();
  const messages = new AgentMessageStore();
  const invoices = new InvoiceStore();
  const quotes = new QuoteStore();
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
    bus,
    emailer,
    flow: new SendInvoice(
      conversations,
      messages,
      quotes,
      invoices,
      bus,
      emailer,
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

async function seedAcceptedQuote(
  s: ReturnType<typeof fresh>,
  userId: string,
  estimatedTotal: number,
) {
  const q = await s.quotes.create(userId, {
    summary: "Job",
    lineItems: [],
    estimatedTotal,
    status: "accepted",
  });
  return q;
}

Deno.test("send-invoice: creates invoice from the bound quote, flips→sent, appends action_card, binds conv.invoiceId", async () => {
  await withKv(async () => {
    const s = fresh();
    const quote = await seedAcceptedQuote(s, "u-1", 1200);
    const conv = await s.conversations.update(
      (await s.conversations.create({ userId: "u-1", currentPhase: "terms" }))
        .id,
      { quoteId: quote.id },
    );
    const r = await s.flow.run({ userId: "u-1", conversationId: conv.id });
    assertEquals(r.newMessages.length, 1);
    assertEquals(r.newMessages[0].kind, "action_card");
    assertEquals(
      (r.newMessages[0].payload as { quoteId?: string }).quoteId,
      quote.id,
    );
    assert(r.conversation.invoiceId);
    const inv = await s.invoices.get(r.conversation.invoiceId!);
    assertEquals(inv.status, "sent");
    assertEquals(inv.amount, 1200);
    assertEquals(inv.quoteId, quote.id);
  });
});

Deno.test("send-invoice: re-Send retries email but state-flip + bus emit + invoiceId stay idempotent", async () => {
  await withKv(async () => {
    const s = fresh();
    // deno-lint-ignore no-explicit-any
    const events: any[] = [];
    s.bus.subscribe((e) => {
      if (e.entityType === "invoice") events.push(e);
    });
    const quote = await seedAcceptedQuote(s, "u-1", 500);
    const conv = await s.conversations.update(
      (await s.conversations.create({ userId: "u-1", currentPhase: "terms" }))
        .id,
      { quoteId: quote.id },
    );
    const a = await s.flow.run({ userId: "u-1", conversationId: conv.id });
    const b = await s.flow.run({ userId: "u-1", conversationId: conv.id });
    assertEquals(a.conversation.invoiceId, b.conversation.invoiceId);
    // State flip + bus emit fire once. Email dispatch retries every
    // click — a previously-failed delivery (POSTMARK_FROM unset,
    // network blip) shouldn't leave the invoice "sent" without ever
    // reaching the customer.
    assertEquals(events.filter((e) => e.action === "sent").length, 1);
  });
});

Deno.test("send-invoice: forbidden when conversation has no quote bound", async () => {
  await withKv(async () => {
    const s = fresh();
    const conv = await s.conversations.create({
      userId: "u-1",
      currentPhase: "quote",
    });
    await assertRejects(
      () => s.flow.run({ userId: "u-1", conversationId: conv.id }),
      Error,
      "no bound quote",
    );
  });
});

Deno.test("send-invoice: forbidden across users", async () => {
  await withKv(async () => {
    const s = fresh();
    const quote = await seedAcceptedQuote(s, "u-A", 100);
    const conv = await s.conversations.update(
      (await s.conversations.create({ userId: "u-B", currentPhase: "terms" }))
        .id,
      { quoteId: quote.id },
    );
    await assertRejects(
      () => s.flow.run({ userId: "u-B", conversationId: conv.id }),
    );
  });
});

Deno.test("send-invoice: emits 'invoice:sent' on the bus", async () => {
  await withKv(async () => {
    const s = fresh();
    // deno-lint-ignore no-explicit-any
    const events: any[] = [];
    s.bus.subscribe((e) => {
      events.push(e);
    });
    const quote = await seedAcceptedQuote(s, "u-1", 999);
    const conv = await s.conversations.update(
      (await s.conversations.create({ userId: "u-1", currentPhase: "terms" }))
        .id,
      { quoteId: quote.id },
    );
    await s.flow.run({ userId: "u-1", conversationId: conv.id });
    const sent = events.find((e) =>
      e.entityType === "invoice" && e.action === "sent"
    );
    assert(sent);
  });
});
