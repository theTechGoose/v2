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

// REQ-024 — NW-13 / NW-18: the invoice path runs the invoice wizard.
Deno.test("REQ-024 transition-to-terms integration: docKind 'invoice' seeds the invoice wizard and records the kind on the conversation", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, flow } = fresh();
  const conv = await conversations.create({ userId: "u-1", quoteId: "q-1" });

  const result = await flow.run({ userId: "u-1", conversationId: conv.id, docKind: "invoice" });

  assertEquals(result.conversation.currentPhase, "terms");
  assertEquals(result.conversation.docKind, "invoice");
  const state = await conversations.getWizardState(conv.id);
  assertEquals(state?.specId, "invoice-v1");
  const wizardPayload = result.newMessages[1].payload as { specId: string; stepId: string };
  assertEquals(wizardPayload.specId, "invoice-v1");
  assertEquals(wizardPayload.stepId, "customer");
  await resetKv();
});

Deno.test("REQ-024 transition-to-terms integration: the default stays the quote wizard", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, flow } = fresh();
  const conv = await conversations.create({ userId: "u-1", quoteId: "q-1" });
  await flow.run({ userId: "u-1", conversationId: conv.id });
  const state = await conversations.getWizardState(conv.id);
  assertEquals(state?.specId, "terms-v1");
  await resetKv();
});

// REQ-258 (demo M22): the invoice wizard's first steps are customer then
// completion date; a prefill whose step IS the first step is suggested at
// transition time too (here: a spec-agnostic check via the payload field).
Deno.test("REQ-258 transition-to-terms integration: the first wizard step carries a suggestion only when the prefill names that step", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, flow } = fresh();
  const conv = await conversations.create({ userId: "u-1" });
  await conversations.update(conv.id, { termsPrefill: { customer: "use_active" } });
  const r = await flow.run({ userId: "u-1", conversationId: conv.id });
  assertEquals((r.newMessages[1].payload as { suggestedOptionId?: string }).suggestedOptionId, "use_active");
  await resetKv();
});

// REQ-343 — demo-loop cycle 1, p3 + p6: the wizard a conversation gets
// follows the business's trade (read off the business name, like the sample
// quote): a cleaner's quote wizard offers hours and asks no warranty; a
// painter's keeps the warranty and never offers "Job completed".
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { getWizardSpec } from "@agents/domain/business/terms-wizard-spec/mod.ts";

Deno.test("REQ-343 transition-to-terms: a cleaning business gets the service wizard (hours, no warranty)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const conversations = new AgentConversationStore();
  const messages = new AgentMessageStore();
  const identity = new BusinessIdentityStore();
  await identity.upsert("u-clean", { businessName: "Sparkle Home Cleaning" });
  const flow = new TransitionToTerms(conversations, messages, identity);
  const conv = await conversations.create({ userId: "u-clean", quoteId: "q-1" });

  const result = await flow.run({ userId: "u-clean", conversationId: conv.id });
  const payload = result.newMessages[1].payload as { specId: string };
  assertEquals(payload.specId, "terms-service-v1");
  const state = await conversations.getWizardState(conv.id);
  assertEquals(state?.specId, "terms-service-v1");
  const spec = getWizardSpec(state!.specId);
  assertEquals(spec.steps.some((s) => s.id === "warranty"), false);
  const wraps = spec.steps.find((s) => s.id === "wraps")!;
  assertEquals(wraps.options[0].id, "2_hours");
  await resetKv();
});

Deno.test("REQ-343 transition-to-terms: a painter keeps the generic wizard — warranty asked, no 'Job completed'", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const conversations = new AgentConversationStore();
  const messages = new AgentMessageStore();
  const identity = new BusinessIdentityStore();
  await identity.upsert("u-paint", { businessName: "Jim Paints" });
  const flow = new TransitionToTerms(conversations, messages, identity);
  const conv = await conversations.create({ userId: "u-paint", quoteId: "q-1" });

  const result = await flow.run({ userId: "u-paint", conversationId: conv.id });
  const payload = result.newMessages[1].payload as { specId: string };
  assertEquals(payload.specId, "terms-v1");
  const spec = getWizardSpec(payload.specId);
  assertEquals(spec.steps.some((s) => s.id === "warranty"), true);
  const wraps = spec.steps.find((s) => s.id === "wraps")!;
  assertEquals(wraps.options.some((o) => o.id === "job_completed"), false);
  await resetKv();
});

Deno.test("REQ-343 transition-to-terms: no identity store / no business name → the generic wizard", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const conversations = new AgentConversationStore();
  const messages = new AgentMessageStore();
  const flow = new TransitionToTerms(conversations, messages);
  const conv = await conversations.create({ userId: "u-none", quoteId: "q-1" });
  const result = await flow.run({ userId: "u-none", conversationId: conv.id });
  assertEquals((result.newMessages[1].payload as { specId: string }).specId, "terms-v1");
  await resetKv();
});
