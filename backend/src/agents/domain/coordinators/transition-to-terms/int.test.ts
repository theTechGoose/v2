import { assertEquals, assertRejects } from "#std/assert";
import { TransitionToTerms } from "./mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

function fresh() {
  const conversations = new AgentConversationStore();
  const messages = new AgentMessageStore();
  const flow = new TransitionToTerms(conversations, messages);
  return { conversations, messages, flow };
}

Deno.test("transition-to-terms integration: flips phase, seeds wizard, appends divider + first step", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, messages, flow } = fresh();
  const conv = await conversations.create({ userId: "u-1", quoteId: "q-1" });

  const result = await flow.run({ userId: "u-1", conversationId: conv.id });

  assertEquals(result.conversation.currentPhase, "terms");
  assertEquals(result.newMessages.length, 2);
  assertEquals(result.newMessages[0].kind, "phase_divider");
  assertEquals(result.newMessages[1].kind, "wizard");

  const wizardPayload = result.newMessages[1].payload as { stepId: string; stepIdx: number };
  assertEquals(wizardPayload.stepIdx, 0);
  assertEquals(wizardPayload.stepId, "customer");

  const state = await conversations.getWizardState(conv.id);
  assertEquals(state?.activeStepIdx, 0);
  assertEquals(state?.answers.length, 0);

  // Divider + wizard message persisted.
  const all = await messages.listByConversation(conv.id);
  assertEquals(all.length, 2);

  await resetKv();
});

Deno.test("transition-to-terms integration: forbidden across users", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, flow } = fresh();
  const conv = await conversations.create({ userId: "u-1" });
  await assertRejects(
    () => flow.run({ userId: "u-2", conversationId: conv.id }),
    Error,
    "forbidden",
  );
  await resetKv();
});

Deno.test("transition-to-terms integration: re-calling on already-terms conversation re-emits current step (no divider dup)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, messages, flow } = fresh();
  const conv = await conversations.create({ userId: "u-1" });

  await flow.run({ userId: "u-1", conversationId: conv.id });          // first transition
  const second = await flow.run({ userId: "u-1", conversationId: conv.id });  // re-call

  assertEquals(second.newMessages.length, 1);                              // no new divider
  assertEquals(second.newMessages[0].kind, "wizard");

  // Total messages: divider + wizard (1st call) + wizard (2nd call) = 3.
  const all = await messages.listByConversation(conv.id);
  assertEquals(all.length, 3);

  await resetKv();
});
