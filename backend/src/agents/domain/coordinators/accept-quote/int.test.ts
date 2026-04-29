import { assert, assertEquals, assertRejects } from "#std/assert";
import { AcceptQuote } from "./mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

function fresh() {
  const conversations = new AgentConversationStore();
  const messages = new AgentMessageStore();
  const quotes = new QuoteStore();
  const bus = new EventBus();
  return { conversations, messages, quotes, bus, flow: new AcceptQuote(conversations, messages, quotes, bus) };
}

async function withKv<T>(fn: () => Promise<T>): Promise<T> {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  try { return await fn(); } finally { await resetKv(); }
}

async function seedConvWithQuote(s: ReturnType<typeof fresh>, userId: string, quoteId: string) {
  const conv = await s.conversations.create({ userId, currentPhase: "quote" });
  return await s.conversations.update(conv.id, { quoteId });
}

Deno.test("accept-quote integration: flips quote→accepted, appends phase_divider + continue_cta, marks unread", async () => {
  await withKv(async () => {
    const s = fresh();
    const quote = await s.quotes.create("u-1", { summary: "x", lineItems: [], status: "sent" });
    const conv = await seedConvWithQuote(s, "u-1", quote.id);
    const r = await s.flow.run({ userId: "u-1", conversationId: conv.id, quoteId: quote.id });
    assertEquals(r.newMessages.length, 2);
    assertEquals(r.newMessages[0].kind, "phase_divider");
    assertEquals(r.newMessages[1].kind, "continue_cta");
    assertEquals((r.newMessages[1].payload as { toPhase?: string } | undefined)?.toPhase, "terms");
    assertEquals(r.conversation.hasUnreadEvent, true);
    const after = await s.quotes.get(quote.id);
    assertEquals(after.status, "accepted");
  });
});

Deno.test("accept-quote integration: idempotent on already-accepted quote", async () => {
  await withKv(async () => {
    const s = fresh();
    const quote = await s.quotes.create("u-1", { summary: "x", lineItems: [], status: "accepted" });
    const conv = await seedConvWithQuote(s, "u-1", quote.id);
    await s.flow.run({ userId: "u-1", conversationId: conv.id, quoteId: quote.id });
    const after = await s.quotes.get(quote.id);
    assertEquals(after.status, "accepted");
  });
});

Deno.test("accept-quote integration: cross-owner is forbidden", async () => {
  await withKv(async () => {
    const s = fresh();
    const quoteA = await s.quotes.create("u-A", { summary: "x", lineItems: [], status: "sent" });
    const convB = await seedConvWithQuote(s, "u-B", quoteA.id);
    await assertRejects(
      () => s.flow.run({ userId: "u-B", conversationId: convB.id, quoteId: quoteA.id }),
    );
  });
});

Deno.test("accept-quote integration: rejects a quote id that doesn't match conv.quoteId", async () => {
  await withKv(async () => {
    const s = fresh();
    const bound = await s.quotes.create("u-1", { summary: "bound", lineItems: [], status: "sent" });
    const stray = await s.quotes.create("u-1", { summary: "stray", lineItems: [], status: "sent" });
    const conv = await seedConvWithQuote(s, "u-1", bound.id);
    await assertRejects(
      () => s.flow.run({ userId: "u-1", conversationId: conv.id, quoteId: stray.id }),
      Error,
      "quoteId does not match",
    );
  });
});

Deno.test("accept-quote integration: emits quote:accepted on the bus", async () => {
  await withKv(async () => {
    const s = fresh();
    // deno-lint-ignore no-explicit-any
    const events: any[] = [];
    s.bus.subscribe((e) => { events.push(e); });
    const quote = await s.quotes.create("u-1", { summary: "x", lineItems: [], status: "sent" });
    const conv = await seedConvWithQuote(s, "u-1", quote.id);
    await s.flow.run({ userId: "u-1", conversationId: conv.id, quoteId: quote.id });
    const accepted = events.find((e) => e.entityType === "quote" && e.action === "accepted");
    assert(accepted);
  });
});
