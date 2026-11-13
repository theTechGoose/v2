/**
 * REQ-688 (demo-loop cycle 5, issue m65) — "Price disappears from the quote
 * checklist". Entering the terms wizard for a priced quote writes the
 * "Price: $1,850.00" pick line (wizardStepId "price") ahead of the first
 * question; a later price edit rewrites it on the next thread read; and
 * stepping back through the wizard never pops it.
 */
import { assert, assertEquals } from "#std/assert";
import { TransitionToTerms } from "./mod.ts";
import { LoadConversation } from "@agents/domain/coordinators/load-conversation/mod.ts";
import { HandleWizardAnswer } from "@agents/domain/coordinators/handle-wizard-answer/mod.ts";
import { RewindWizard } from "@agents/domain/coordinators/rewind-wizard/mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import type { AgentMessage } from "@agents/dto/message.ts";

function fresh() {
  const conversations = new AgentConversationStore();
  const messages = new AgentMessageStore();
  const quotes = new QuoteStore();
  const customers = new CustomerStore();
  return {
    conversations,
    messages,
    quotes,
    customers,
    transition: new TransitionToTerms(conversations, messages),
    load: new LoadConversation(conversations, messages, quotes, customers),
    answer: new HandleWizardAnswer(
      conversations,
      messages,
      quotes,
      customers,
      new UserStore(),
      new EventBus(),
    ),
    rewind: new RewindWizard(conversations, messages),
  };
}

const pricePicks = (msgs: AgentMessage[]) =>
  msgs.filter((m) =>
    m.role === "user" && m.kind === "text" &&
    (m.payload as { wizardStepId?: string } | undefined)?.wizardStepId ===
      "price"
  );

async function pricedThread(cents = 185_000) {
  const f = fresh();
  const quote = await f.quotes.create("u-1", {
    summary: "Deck repair",
    jobName: "Deck repair",
    lineItems: [{
      description: "Deck repair",
      quantity: 1,
      unit: "ea",
      price: cents,
    }],
    estimatedTotal: cents,
  });
  const conv = await f.conversations.create({
    userId: "u-1",
    quoteId: quote.id,
  });
  return { ...f, quote, conv };
}

Deno.test("REQ-688 transition-to-terms: a priced quote writes 'Price: $1,850.00' (wizardStepId 'price') before the first question", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { transition, messages, conv } = await pricedThread();

  const res = await transition.run({ userId: "u-1", conversationId: conv.id });

  const kinds = res.newMessages.map((m) => m.kind);
  assertEquals(kinds, ["phase_divider", "text", "wizard"]);
  const all = await messages.listByConversation(conv.id);
  const picks = pricePicks(all);
  assertEquals(picks.length, 1, JSON.stringify(all.map((m) => m.content)));
  assertEquals(picks[0].content, "Price: $1,850.00");
  assertEquals(
    (picks[0].payload as { priceCents?: number }).priceCents,
    185_000,
  );
  // The first question is still the open one.
  assertEquals(all[all.length - 1].kind, "wizard");
  await resetKv();
});

Deno.test("REQ-688 transition-to-terms: Spanish writes 'Precio: $1,850.00'", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { transition, messages, conv } = await pricedThread();
  await transition.run({ userId: "u-1", conversationId: conv.id, lang: "es" });
  const picks = pricePicks(await messages.listByConversation(conv.id));
  assertEquals(picks[0]?.content, "Precio: $1,850.00");
  await resetKv();
});

Deno.test("REQ-688 transition-to-terms: no quote / no price → no price line", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { transition, conversations, messages } = fresh();
  const conv = await conversations.create({ userId: "u-1" });
  await transition.run({ userId: "u-1", conversationId: conv.id });
  assertEquals(
    pricePicks(await messages.listByConversation(conv.id)).length,
    0,
  );
  await resetKv();
});

Deno.test("REQ-688 transition-to-terms: re-calling on a terms thread does not write a second price line", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { transition, messages, conv } = await pricedThread();
  await transition.run({ userId: "u-1", conversationId: conv.id });
  await transition.run({ userId: "u-1", conversationId: conv.id });
  assertEquals(
    pricePicks(await messages.listByConversation(conv.id)).length,
    1,
  );
  await resetKv();
});

Deno.test("REQ-688 load-conversation: a later price edit rewrites the price line", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { transition, load, quotes, messages, quote, conv } =
    await pricedThread();
  await transition.run({ userId: "u-1", conversationId: conv.id });
  await quotes.update(quote.id, "u-1", { estimatedTotal: 210_000 });

  const snap = await load.run({ userId: "u-1", conversationId: conv.id });
  const shown = pricePicks(snap.messages);
  assertEquals(shown.length, 1);
  assertEquals(shown[0].content, "Price: $2,100.00");
  // Persisted, not only projected.
  const stored = pricePicks(await messages.listByConversation(conv.id));
  assertEquals(stored[0].content, "Price: $2,100.00");
  assertEquals(
    (stored[0].payload as { priceCents?: number }).priceCents,
    210_000,
  );
  await resetKv();
});

Deno.test("REQ-688 rewind-wizard: stepping back pops the customer pick, never the price line", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const f = fresh();
  const customer = await f.customers.create("u-1", { name: "Dave Roof" });
  const quote = await f.quotes.create("u-1", {
    summary: "Deck repair",
    jobName: "Deck repair",
    lineItems: [{
      description: "Deck repair",
      quantity: 1,
      unit: "ea",
      price: 185_000,
    }],
    estimatedTotal: 185_000,
    customerId: customer.id,
  });
  const conv = await f.conversations.create({
    userId: "u-1",
    quoteId: quote.id,
    customerId: customer.id,
  });
  await f.transition.run({ userId: "u-1", conversationId: conv.id });
  await f.answer.run({
    userId: "u-1",
    conversationId: conv.id,
    stepId: "customer",
    optionId: "use_active",
  });
  const before = await f.messages.listByConversation(conv.id);
  assert(
    before.some((m) =>
      (m.payload as { wizardStepId?: string } | undefined)?.wizardStepId ===
        "customer"
    ),
  );
  await f.rewind.run({ userId: "u-1", conversationId: conv.id });
  const after = await f.messages.listByConversation(conv.id);
  const ids = (ms: AgentMessage[]) => ms.map((m) => m.content);
  assertEquals(pricePicks(after).length, 1, JSON.stringify(ids(after)));
  assert(
    !after.some((m) =>
      (m.payload as { wizardStepId?: string } | undefined)?.wizardStepId ===
        "customer"
    ),
    JSON.stringify(ids(after)),
  );
  await resetKv();
});
