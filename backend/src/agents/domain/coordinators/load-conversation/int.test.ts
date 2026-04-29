import { assertEquals, assertRejects } from "#std/assert";
import { LoadConversation } from "./mod.ts";
import { TransitionToTerms } from "@agents/domain/coordinators/transition-to-terms/mod.ts";
import { HandleWizardAnswer } from "@agents/domain/coordinators/handle-wizard-answer/mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { ContractStore } from "@paperwork/domain/data/contract-store/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

function fresh() {
  const conversations = new AgentConversationStore();
  const messages = new AgentMessageStore();
  const quotes = new QuoteStore();
  const contracts = new ContractStore();
  const bus = new EventBus();
  return {
    conversations, messages,
    transition: new TransitionToTerms(conversations, messages),
    wizardAnswer: new HandleWizardAnswer(conversations, messages, quotes, contracts, bus),
    load: new LoadConversation(conversations, messages, contracts),
  };
}

Deno.test("load-conversation integration: returns conversation + empty messages, no wizard, when fresh", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, load } = fresh();
  const conv = await conversations.create({ userId: "u-1" });
  const snap = await load.run({ userId: "u-1", conversationId: conv.id });
  assertEquals(snap.conversation.id, conv.id);
  assertEquals(snap.messages, []);
  assertEquals(snap.wizard, undefined);
  await resetKv();
});

Deno.test("load-conversation integration: includes wizard state + progress when in terms phase", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, transition, wizardAnswer, load } = fresh();
  const conv = await conversations.create({ userId: "u-1" });
  await transition.run({ userId: "u-1", conversationId: conv.id });
  await wizardAnswer.run({ userId: "u-1", conversationId: conv.id, stepId: "config", optionId: "standard_residential" });

  const snap = await load.run({ userId: "u-1", conversationId: conv.id });
  assertEquals(snap.conversation.currentPhase, "terms");
  assertEquals(snap.wizard?.state.activeStepIdx, 1);
  assertEquals(snap.wizard?.progress.activeStep?.id, "customer");
  assertEquals(snap.wizard?.progress.completedSteps.length, 1);
  await resetKv();
});

Deno.test("load-conversation integration: returns messages oldest-first", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, messages, load } = fresh();
  const conv = await conversations.create({ userId: "u-1" });
  await messages.append({ conversationId: conv.id, role: "user", kind: "text", content: "first" });
  await new Promise((r) => setTimeout(r, 5));
  await messages.append({ conversationId: conv.id, role: "assistant", kind: "text", content: "second" });

  const snap = await load.run({ userId: "u-1", conversationId: conv.id });
  assertEquals(snap.messages[0].content, "first");
  assertEquals(snap.messages[1].content, "second");
  await resetKv();
});

Deno.test("load-conversation integration: forbidden across users", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, load } = fresh();
  const conv = await conversations.create({ userId: "u-1" });
  await assertRejects(
    () => load.run({ userId: "u-2", conversationId: conv.id }),
    Error,
    "forbidden",
  );
  await resetKv();
});
