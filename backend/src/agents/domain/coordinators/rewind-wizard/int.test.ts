import { assert, assertEquals } from "#std/assert";
import { RewindWizard } from "./mod.ts";
import { TransitionToTerms } from "@agents/domain/coordinators/transition-to-terms/mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

// REQ-005 — NW-19: back from the wizard's FIRST question, reached via chat
// ("Lock it in" → "Ready" CTA), must leave the terms phase and return the
// transcript to the action card — not exit the assistant.

function fresh() {
  const conversations = new AgentConversationStore();
  const messages = new AgentMessageStore();
  return {
    conversations,
    messages,
    toTerms: new TransitionToTerms(conversations, messages),
    rewind: new RewindWizard(conversations, messages),
  };
}

Deno.test("REQ-005 NW-19 rewind-wizard integration: toStepIdx -1 at step 0 leaves the terms phase (wizard + divider removed, state cleared)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, messages, toTerms, rewind } = fresh();
  const conv = await conversations.create({ userId: "u-1", quoteId: "q-1" });
  // The chat-path transcript: the locked action card + the "Ready" CTA.
  const card = await messages.append({
    conversationId: conv.id,
    role: "assistant",
    kind: "action_card",
    content: "Quote locked",
    payload: { quoteId: "q-1", status: "sent" },
  });
  const cta = await messages.append({
    conversationId: conv.id,
    role: "assistant",
    kind: "continue_cta",
    content: "Ready",
    payload: { toPhase: "terms", quoteId: "q-1" },
  });
  const trans = await toTerms.run({ userId: "u-1", conversationId: conv.id });
  const wizardMsg = trans.newMessages.find((m) => m.kind === "wizard")!;
  const divider = trans.newMessages.find((m) => m.kind === "phase_divider")!;

  const res = await rewind.run({ userId: "u-1", conversationId: conv.id, toStepIdx: -1 });

  assertEquals(res.conversation.currentPhase, "quote");
  assertEquals(res.activeStepId, null);
  assert(res.removedMessageIds.includes(wizardMsg.id), "wizard message removed");
  assert(res.removedMessageIds.includes(divider.id), "phase divider removed");

  const stored = await conversations.get(conv.id);
  assertEquals(stored.currentPhase, "quote");
  assertEquals(await conversations.getWizardState(conv.id), null);

  const left = await messages.listByConversation(conv.id);
  assertEquals(left.map((m) => m.id), [card.id, cta.id]);

  await resetKv();
});

Deno.test("REQ-005 NW-19 rewind-wizard integration: after leaving terms, the CTA can re-enter the wizard fresh", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, messages, toTerms, rewind } = fresh();
  const conv = await conversations.create({ userId: "u-1", quoteId: "q-1" });
  await toTerms.run({ userId: "u-1", conversationId: conv.id });
  await rewind.run({ userId: "u-1", conversationId: conv.id, toStepIdx: -1 });

  const again = await toTerms.run({ userId: "u-1", conversationId: conv.id });
  assertEquals(again.conversation.currentPhase, "terms");
  assertEquals(again.newMessages.map((m) => m.kind), ["phase_divider", "wizard"]);
  const all = await messages.listByConversation(conv.id);
  assertEquals(all.length, 2);
  assertEquals((await conversations.getWizardState(conv.id))?.activeStepIdx, 0);

  await resetKv();
});

Deno.test("REQ-005 NW-19 rewind-wizard integration: toStepIdx -1 from a later step first pops to 0, then leaves", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, messages, toTerms, rewind } = fresh();
  const conv = await conversations.create({ userId: "u-1", quoteId: "q-1" });
  await toTerms.run({ userId: "u-1", conversationId: conv.id });
  // Simulate one answered step: the pick + the next question.
  await conversations.putWizardState(conv.id, {
    specId: "terms-v1",
    activeStepIdx: 1,
    answers: [{ stepId: "customer", optionId: "create_new", answeredAt: new Date().toISOString() }],
  });
  await messages.append({
    conversationId: conv.id,
    role: "user",
    kind: "text",
    content: "Create new",
    payload: { wizardStepId: "customer", optionId: "create_new" },
  });
  await messages.append({
    conversationId: conv.id,
    role: "assistant",
    kind: "wizard",
    content: "When does the job start?",
    payload: { specId: "terms-v1", stepIdx: 1, stepId: "start_date", options: [] },
  });

  const res = await rewind.run({ userId: "u-1", conversationId: conv.id, toStepIdx: -1 });
  assertEquals(res.conversation.currentPhase, "quote");
  assertEquals(await messages.listByConversation(conv.id), []);
  assertEquals(await conversations.getWizardState(conv.id), null);

  await resetKv();
});
