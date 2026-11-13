import { assert, assertEquals, assertRejects } from "#std/assert";
import { ReopenQuote } from "./mod.ts";
import { RewindWizard } from "@agents/domain/coordinators/rewind-wizard/mod.ts";
import { LockQuote } from "@agents/domain/coordinators/lock-quote/mod.ts";
import { TransitionToTerms } from "@agents/domain/coordinators/transition-to-terms/mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

// REQ-334 (demo-loop cycle 1, M25): "Re-open" on the locked quote card must
// actually re-open the quote — leave the terms wizard, drop the locked card
// and its "Ready" CTA, clear lockedAt — so the draft card (Lock / Edit) is
// back. It used to post "Re-open the quote." to the chat, which nothing handled.

async function fresh() {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const conversations = new AgentConversationStore();
  const messages = new AgentMessageStore();
  const quotes = new QuoteStore();
  const users = new UserStore();
  const user = await users.create({ phoneNumber: "+15125550101" });
  const quote = await quotes.create(user.id, {
    summary: "Roof",
    lineItems: [{
      description: "Shingles",
      quantity: 1,
      unit: "ea",
      price: 10000,
    }],
    estimatedTotal: 10000,
  });
  const conv = await conversations.create({ userId: user.id });
  const draftCard = await messages.append({
    conversationId: conv.id,
    role: "assistant",
    kind: "action_card",
    content: "Roof",
    payload: {
      actionType: "quote",
      status: "draft",
      quoteId: quote.id,
      lineItems: [],
      totalCents: 10000,
    },
  });
  const lock = new LockQuote(conversations, messages, quotes, users);
  const toTerms = new TransitionToTerms(conversations, messages);
  const rewind = new RewindWizard(conversations, messages);
  const reopen = new ReopenQuote(conversations, messages, quotes, rewind);
  return {
    conversations,
    messages,
    quotes,
    user,
    quote,
    conv,
    draftCard,
    lock,
    toTerms,
    reopen,
  };
}

Deno.test("REQ-334 M25 reopen-quote integration: from the terms wizard, Re-open leaves terms, drops the locked card + CTA, clears lockedAt and keeps the draft card", async () => {
  const f = await fresh();
  const locked = await f.lock.run({
    userId: f.user.id,
    conversationId: f.conv.id,
    quoteId: f.quote.id,
  });
  assertEquals(locked.conversation.quoteStatus, "locked");
  assert(
    (await f.quotes.getOwned(f.quote.id, f.user.id)).lockedAt,
    "locked stamps lockedAt",
  );
  await f.toTerms.run({ userId: f.user.id, conversationId: f.conv.id });
  assertEquals((await f.conversations.get(f.conv.id)).currentPhase, "terms");

  const res = await f.reopen.run({
    userId: f.user.id,
    conversationId: f.conv.id,
    quoteId: f.quote.id,
  });

  assertEquals(res.conversation.currentPhase, "quote");
  assertEquals(res.conversation.quoteStatus, "draft");
  const stored = await f.conversations.get(f.conv.id);
  assertEquals(stored.currentPhase, "quote");
  assertEquals(stored.quoteStatus, "draft");
  assertEquals(await f.conversations.getWizardState(f.conv.id), null);

  const q = await f.quotes.getOwned(f.quote.id, f.user.id);
  assertEquals(q.lockedAt, undefined, "lockedAt cleared");
  assertEquals(q.status, "draft");

  const left = await f.messages.listByConversation(f.conv.id);
  assertEquals(left.map((m) => m.kind), ["action_card"]);
  assertEquals(left[0].id, f.draftCard.id, "the draft card is what remains");
  assertEquals((left[0].payload as { status?: string }).status, "draft");
  for (const id of locked.newMessages.map((m) => m.id)) {
    assert(
      res.removedMessageIds.includes(id),
      `locked card / CTA ${id} removed`,
    );
  }
  await resetKv();
});

Deno.test("REQ-334 M25 reopen-quote integration: locked but the Ready CTA never tapped (still in quote phase) → same unlock", async () => {
  const f = await fresh();
  await f.lock.run({
    userId: f.user.id,
    conversationId: f.conv.id,
    quoteId: f.quote.id,
  });
  const res = await f.reopen.run({
    userId: f.user.id,
    conversationId: f.conv.id,
    quoteId: f.quote.id,
  });
  assertEquals(res.conversation.currentPhase, "quote");
  assertEquals(res.conversation.quoteStatus, "draft");
  assertEquals(
    (await f.quotes.getOwned(f.quote.id, f.user.id)).lockedAt,
    undefined,
  );
  const left = await f.messages.listByConversation(f.conv.id);
  assertEquals(left.map((m) => m.id), [f.draftCard.id]);
  await resetKv();
});

Deno.test("REQ-334 M25 reopen-quote integration: a draft card is re-emitted when the transcript has none for the quote", async () => {
  const f = await fresh();
  await f.messages.deleteByIds(f.conv.id, [f.draftCard.id]);
  await f.lock.run({
    userId: f.user.id,
    conversationId: f.conv.id,
    quoteId: f.quote.id,
  });
  const res = await f.reopen.run({
    userId: f.user.id,
    conversationId: f.conv.id,
    quoteId: f.quote.id,
  });
  assertEquals(res.newMessages.map((m) => m.kind), ["action_card"]);
  assertEquals(
    (res.newMessages[0].payload as { status?: string; quoteId?: string })
      .status,
    "draft",
  );
  assertEquals(
    (res.newMessages[0].payload as { quoteId?: string }).quoteId,
    f.quote.id,
  );
  const left = await f.messages.listByConversation(f.conv.id);
  assertEquals(left.map((m) => m.id), [res.newMessages[0].id]);
  await resetKv();
});

Deno.test("REQ-334 M25 reopen-quote integration: a SENT quote is refused and untouched (revision path instead)", async () => {
  const f = await fresh();
  await f.lock.run({
    userId: f.user.id,
    conversationId: f.conv.id,
    quoteId: f.quote.id,
  });
  await f.quotes.update(f.quote.id, f.user.id, {
    status: "sent",
    sentAt: new Date().toISOString(),
  });
  await assertRejects(
    () =>
      f.reopen.run({
        userId: f.user.id,
        conversationId: f.conv.id,
        quoteId: f.quote.id,
      }),
    Error,
    "sent",
  );
  const q = await f.quotes.getOwned(f.quote.id, f.user.id);
  assertEquals(q.status, "sent");
  assert(q.lockedAt, "lockedAt kept");
  await resetKv();
});

Deno.test("REQ-334 M25 reopen-quote integration: a stranger is refused", async () => {
  const f = await fresh();
  await f.lock.run({
    userId: f.user.id,
    conversationId: f.conv.id,
    quoteId: f.quote.id,
  });
  await assertRejects(
    () =>
      f.reopen.run({
        userId: "u-stranger",
        conversationId: f.conv.id,
        quoteId: f.quote.id,
      }),
    Error,
    "forbidden",
  );
  await resetKv();
});
