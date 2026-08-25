import { assert, assertEquals, assertRejects } from "#std/assert";
import { AcceptQuote } from "./mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

function fresh() {
  const conversations = new AgentConversationStore();
  const messages = new AgentMessageStore();
  const quotes = new QuoteStore();
  const users = new UserStore();
  const bus = new EventBus();
  return {
    conversations,
    messages,
    quotes,
    users,
    bus,
    flow: new AcceptQuote(conversations, messages, quotes, users, bus),
  };
}

async function withKv<T>(fn: () => Promise<T>): Promise<T> {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  try {
    return await fn();
  } finally {
    await resetKv();
  }
}

async function seedConvWithQuote(
  s: ReturnType<typeof fresh>,
  userId: string,
  quoteId: string,
) {
  const conv = await s.conversations.create({ userId, currentPhase: "terms" });
  // quoteId is set via update (not on create)
  return await s.conversations.update(conv.id, { quoteId });
}

Deno.test("accept-quote integration: flips status to accepted, appends phase_divider + continue_cta(invoice), marks conversation unread", async () => {
  await withKv(async () => {
    const s = fresh();
    const quote = await s.quotes.create("u-1", {
      summary: "Re-roof",
      lineItems: [],
      status: "sent",
    });
    const conv = await seedConvWithQuote(s, "u-1", quote.id);

    const result = await s.flow.run({
      userId: "u-1",
      conversationId: conv.id,
      quoteId: quote.id,
    });

    assertEquals(result.newMessages.length, 2);
    assertEquals(result.newMessages[0].kind, "phase_divider");
    assertEquals(
      (result.newMessages[0].payload as { quoteId?: string } | undefined)
        ?.quoteId,
      quote.id,
    );
    assertEquals(result.newMessages[1].kind, "continue_cta");
    assertEquals(
      (result.newMessages[1].payload as { toPhase?: string } | undefined)
        ?.toPhase,
      "invoice",
    );
    assertEquals(
      (result.newMessages[1].payload as { quoteId?: string } | undefined)
        ?.quoteId,
      quote.id,
    );
    assertEquals(result.conversation.hasUnreadEvent, true);
    assertEquals(result.conversation.quoteStatus, "accepted");
    const after = await s.quotes.getOwned(quote.id, "u-1");
    assertEquals(after.status, "accepted");
    assert(after.acceptedAt, "acceptedAt should be stamped");
  });
});

Deno.test("accept-quote integration: idempotent on already-accepted quote (no second flip, no event)", async () => {
  await withKv(async () => {
    const s = fresh();
    // deno-lint-ignore no-explicit-any
    const events: any[] = [];
    s.bus.subscribe((evt) => {
      events.push(evt);
    });
    const quote = await s.quotes.create("u-1", {
      summary: "Re-roof",
      lineItems: [],
      status: "accepted",
      acceptedAt: "2026-04-01T00:00:00Z",
    });
    const conv = await seedConvWithQuote(s, "u-1", quote.id);
    await s.flow.run({
      userId: "u-1",
      conversationId: conv.id,
      quoteId: quote.id,
    });
    const after = await s.quotes.getOwned(quote.id, "u-1");
    assertEquals(after.status, "accepted");
    assertEquals(after.acceptedAt, "2026-04-01T00:00:00Z");
    assertEquals(
      events.filter((e) => e.entityType === "quote" && e.action === "accepted"),
      [],
    );
  });
});

Deno.test("accept-quote integration: cross-owner is forbidden", async () => {
  await withKv(async () => {
    const s = fresh();
    const quote = await s.quotes.create("u-A", { summary: "x", lineItems: [] });
    const conv = await seedConvWithQuote(s, "u-B", quote.id);
    await assertRejects(
      () =>
        s.flow.run({
          userId: "u-B",
          conversationId: conv.id,
          quoteId: quote.id,
        }),
    );
  });
});

Deno.test("accept-quote integration: emits quote:accepted on the bus", async () => {
  await withKv(async () => {
    const s = fresh();
    // deno-lint-ignore no-explicit-any
    const events: any[] = [];
    s.bus.subscribe((evt) => {
      events.push(evt);
    });
    const quote = await s.quotes.create("u-1", {
      summary: "x",
      lineItems: [],
      status: "sent",
    });
    const conv = await seedConvWithQuote(s, "u-1", quote.id);
    await s.flow.run({
      userId: "u-1",
      conversationId: conv.id,
      quoteId: quote.id,
    });
    const accepted = events.find((e) =>
      e.entityType === "quote" && e.action === "accepted"
    );
    assert(accepted);
    assertEquals(accepted.entityId, quote.id);
  });
});

Deno.test("accept-quote integration: quoteId must match the conversation's bound quote", async () => {
  await withKv(async () => {
    const s = fresh();
    const bound = await s.quotes.create("u-1", { summary: "a", lineItems: [] });
    const stray = await s.quotes.create("u-1", { summary: "b", lineItems: [] });
    const conv = await seedConvWithQuote(s, "u-1", bound.id);
    await assertRejects(
      () =>
        s.flow.run({
          userId: "u-1",
          conversationId: conv.id,
          quoteId: stray.id,
        }),
      Error,
      "does not match",
    );
  });
});
