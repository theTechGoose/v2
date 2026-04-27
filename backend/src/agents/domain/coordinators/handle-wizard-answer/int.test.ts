import { assert, assertEquals, assertRejects } from "#std/assert";
import { HandleWizardAnswer } from "./mod.ts";
import { TransitionToTerms } from "@agents/domain/coordinators/transition-to-terms/mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { ContractStore } from "@paperwork/domain/data/contract-store/mod.ts";
import { EventBus, type DomainEvent } from "@core/events/mod.ts";
import { CONTRACT_TERMS_WIZARD_V1 } from "@agents/domain/business/contract-terms-wizard-spec/mod.ts";
import type { AgentMessage } from "@agents/dto/message.ts";
import { resetKv } from "@core/data/kv/mod.ts";

function fresh() {
  const conversations = new AgentConversationStore();
  const messages = new AgentMessageStore();
  const quotes = new QuoteStore();
  const contracts = new ContractStore();
  const bus = new EventBus();
  const transitionFlow = new TransitionToTerms(conversations, messages);
  const flow = new HandleWizardAnswer(conversations, messages, quotes, contracts, bus);
  return { conversations, messages, quotes, contracts, bus, transitionFlow, flow };
}

async function setupTermsConversation(userId = "u-1") {
  const ctx = fresh();
  const conv = await ctx.conversations.create({ userId });
  await ctx.transitionFlow.run({ userId, conversationId: conv.id });
  return { ...ctx, conv };
}

async function setupTermsConversationWithQuote(userId = "u-1") {
  const ctx = fresh();
  const quote = await ctx.quotes.create(userId, { summary: "Roof", lineItems: [], estimatedTotal: 12_500, status: "sent" });
  const conv = await ctx.conversations.create({ userId, quoteId: quote.id, customerId: "cust-1" });
  await ctx.transitionFlow.run({ userId, conversationId: conv.id });
  return { ...ctx, conv, quote };
}

Deno.test("handle-wizard-answer integration: advances state and appends [user-pick, next-wizard]", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, flow, conv } = await setupTermsConversation();

  const result = await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    stepId: "config",
    optionId: "standard_residential",
  });

  assertEquals(result.wizardState.activeStepIdx, 1);
  assertEquals(result.wizardState.answers.length, 1);
  assertEquals(result.newMessages.length, 2);
  assertEquals(result.newMessages[0].kind, "text");                // user pick
  assertEquals(result.newMessages[0].content, "Config: Standard residential");
  assertEquals(result.newMessages[1].kind, "wizard");
  assertEquals((result.newMessages[1].payload as { stepId: string }).stepId, "customer");

  const refreshed = await conversations.getWizardState(conv.id);
  assertEquals(refreshed?.activeStepIdx, 1);

  await resetKv();
});

Deno.test("handle-wizard-answer integration: completing all 10 steps emits a continue_cta to send", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, conv, conversations } = await setupTermsConversation();

  let lastMessages: AgentMessage[] = [];
  for (const step of CONTRACT_TERMS_WIZARD_V1.steps) {
    const opt = step.options.find((o) => !o.isCustom)!;
    const r = await flow.run({ userId: "u-1", conversationId: conv.id, stepId: step.id, optionId: opt.id });
    lastMessages = r.newMessages;
  }

  // Last assistant message must be the continue_cta to send.
  assertEquals(lastMessages[lastMessages.length - 1].kind, "continue_cta");
  const finalState = await conversations.getWizardState(conv.id);
  assertEquals(finalState?.activeStepIdx, 10);
  assertEquals(finalState?.answers.length, 10);

  await resetKv();
});

Deno.test("handle-wizard-answer integration: custom option records customValue in user-pick payload + state", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, conv, conversations } = await setupTermsConversation();

  // Step 1: config
  await flow.run({ userId: "u-1", conversationId: conv.id, stepId: "config", optionId: "standard_residential" });
  // Step 2: customer create_new (isCustom)
  const r = await flow.run({
    userId: "u-1", conversationId: conv.id,
    stepId: "customer", optionId: "create_new", customValue: "Tom & Linda K.",
  });

  assertEquals(r.newMessages[0].content, "Customer: Tom & Linda K.");
  const state = await conversations.getWizardState(conv.id);
  assertEquals(state?.answers[1].customValue, "Tom & Linda K.");

  await resetKv();
});

Deno.test("handle-wizard-answer integration: rejects answer when conversation is in 'quote' phase", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, flow } = fresh();
  const conv = await conversations.create({ userId: "u-1" });   // still in 'quote'
  await assertRejects(
    () => flow.run({ userId: "u-1", conversationId: conv.id, stepId: "config", optionId: "standard_residential" }),
    Error,
    "not in 'terms' phase",
  );
  await resetKv();
});

Deno.test("handle-wizard-answer integration: rejects out-of-order step", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, conv } = await setupTermsConversation();
  await assertRejects(
    () => flow.run({ userId: "u-1", conversationId: conv.id, stepId: "warranty", optionId: "12_months" }),
    Error,
    'expected answer for "config"',
  );
  await resetKv();
});

Deno.test("handle-wizard-answer integration: forbidden across users", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, conv } = await setupTermsConversation("u-1");
  await assertRejects(
    () => flow.run({ userId: "u-2", conversationId: conv.id, stepId: "config", optionId: "standard_residential" }),
    Error,
    "forbidden",
  );
  await resetKv();
});

Deno.test("handle-wizard-answer integration: completing all 10 steps materializes a Contract bound to conv.quoteId", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, conv, quote, contracts, conversations } = await setupTermsConversationWithQuote();

  let lastResult;
  for (const step of CONTRACT_TERMS_WIZARD_V1.steps) {
    const opt = step.options.find((o) => !o.isCustom)!;
    lastResult = await flow.run({ userId: "u-1", conversationId: conv.id, stepId: step.id, optionId: opt.id });
  }

  // The continue_cta now carries the new contract id.
  const cta = lastResult!.newMessages[lastResult!.newMessages.length - 1];
  const ctaPayload = cta.payload as { contractId?: string; toPhase: string };
  assert(typeof ctaPayload.contractId === "string", "continue_cta should carry contractId");

  // Conversation now points at the new contract.
  const updatedConv = await conversations.get(conv.id);
  assertEquals(updatedConv.contractId, ctaPayload.contractId);

  // Contract row exists in the store, owned by u-1, bound to the quote.
  const contract = await contracts.getOwned(ctaPayload.contractId!, "u-1");
  assertEquals(contract.quoteId, quote.id);
  assertEquals(contract.customerId, "cust-1");
  assertEquals(contract.status, "draft");
  assertEquals(contract.totalAmount, 12_500);

  await resetKv();
});

Deno.test("handle-wizard-answer integration: completing the wizard emits a 'drafted' contract DomainEvent", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, conv, bus } = await setupTermsConversationWithQuote();
  const seen: DomainEvent[] = [];
  bus.subscribe((e) => { if (e.entityType === "contract") seen.push(e); });

  for (const step of CONTRACT_TERMS_WIZARD_V1.steps) {
    const opt = step.options.find((o) => !o.isCustom)!;
    await flow.run({ userId: "u-1", conversationId: conv.id, stepId: step.id, optionId: opt.id });
  }

  assertEquals(seen.length, 1);
  assertEquals(seen[0].action, "drafted");
  assertEquals(seen[0].entityType, "contract");
  assertEquals(seen[0].userId, "u-1");
  await resetKv();
});

Deno.test("handle-wizard-answer integration: completing the wizard without a bound quote does NOT throw and skips contract creation", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, conv, conversations, contracts } = await setupTermsConversation();   // no quoteId on conv

  let lastResult;
  for (const step of CONTRACT_TERMS_WIZARD_V1.steps) {
    const opt = step.options.find((o) => !o.isCustom)!;
    lastResult = await flow.run({ userId: "u-1", conversationId: conv.id, stepId: step.id, optionId: opt.id });
  }

  const cta = lastResult!.newMessages[lastResult!.newMessages.length - 1];
  assertEquals(cta.kind, "continue_cta");
  // No contractId on the cta payload, no contractId on the conversation.
  assertEquals((cta.payload as { contractId?: string }).contractId, undefined);
  assertEquals((await conversations.get(conv.id)).contractId, undefined);
  assertEquals((await contracts.listByUser("u-1")).length, 0);

  await resetKv();
});

Deno.test("handle-wizard-answer integration: re-completing an already-finalized conversation reuses the same contract id", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, conversations, conv, contracts } = await setupTermsConversationWithQuote();

  let lastResult;
  for (const step of CONTRACT_TERMS_WIZARD_V1.steps) {
    const opt = step.options.find((o) => !o.isCustom)!;
    lastResult = await flow.run({ userId: "u-1", conversationId: conv.id, stepId: step.id, optionId: opt.id });
  }
  const firstContractId = (lastResult!.newMessages.at(-1)!.payload as { contractId: string }).contractId;

  // Roll the wizard back to its last step, then re-answer it. The
  // coordinator should reuse the existing contract rather than creating
  // a second one.
  const rolledBackState = await conversations.getWizardState(conv.id);
  await conversations.putWizardState(conv.id, { ...rolledBackState!, activeStepIdx: 9, answers: rolledBackState!.answers.slice(0, 9) });

  const last = CONTRACT_TERMS_WIZARD_V1.steps[9];
  const opt = last.options.find((o) => !o.isCustom)!;
  const r = await flow.run({ userId: "u-1", conversationId: conv.id, stepId: last.id, optionId: opt.id });
  const secondContractId = (r.newMessages.at(-1)!.payload as { contractId: string }).contractId;

  assertEquals(secondContractId, firstContractId);
  assertEquals((await contracts.listByUser("u-1")).length, 1);

  await resetKv();
});
