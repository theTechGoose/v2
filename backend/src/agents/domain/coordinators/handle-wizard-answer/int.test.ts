import { assert, assertEquals, assertRejects } from "#std/assert";
import { HandleWizardAnswer } from "./mod.ts";
import { TransitionToTerms } from "@agents/domain/coordinators/transition-to-terms/mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { type DomainEvent, EventBus } from "@core/business/events/mod.ts";
import { TERMS_WIZARD_V1 } from "@agents/domain/business/terms-wizard-spec/mod.ts";
import type { AgentMessage } from "@agents/dto/message.ts";
import { resetKv } from "@core/data/kv/mod.ts";

function fresh() {
  const conversations = new AgentConversationStore();
  const messages = new AgentMessageStore();
  const quotes = new QuoteStore();
  const customers = new CustomerStore();
  const users = new UserStore();
  const bus = new EventBus();
  const transitionFlow = new TransitionToTerms(conversations, messages);
  const flow = new HandleWizardAnswer(
    conversations,
    messages,
    quotes,
    customers,
    users,
    bus,
  );
  return {
    conversations,
    messages,
    quotes,
    customers,
    users,
    bus,
    transitionFlow,
    flow,
  };
}

async function setupTermsConversation(userId = "u-1") {
  const ctx = fresh();
  const conv = await ctx.conversations.create({ userId });
  await ctx.transitionFlow.run({ userId, conversationId: conv.id });
  return { ...ctx, conv };
}

async function setupTermsConversationWithQuote(userId = "u-1") {
  const ctx = fresh();
  const quote = await ctx.quotes.create(userId, {
    summary: "Roof",
    lineItems: [],
    estimatedTotal: 12_500,
    status: "sent",
  });
  const conv = await ctx.conversations.create({
    userId,
    quoteId: quote.id,
    customerId: "cust-1",
  });
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
    stepId: "customer",
    optionId: "use_active",
  });

  assertEquals(result.wizardState.activeStepIdx, 1);
  assertEquals(result.wizardState.answers.length, 1);
  assertEquals(result.newMessages.length, 2);
  assertEquals(result.newMessages[0].kind, "text"); // user pick
  assertEquals(result.newMessages[1].kind, "wizard");
  assertEquals(
    (result.newMessages[1].payload as { stepId: string }).stepId,
    "start_date",
  );

  const refreshed = await conversations.getWizardState(conv.id);
  assertEquals(refreshed?.activeStepIdx, 1);

  await resetKv();
});

Deno.test("handle-wizard-answer integration: completing all steps emits a continue_cta to send", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, conv, conversations } = await setupTermsConversation();

  let lastMessages: AgentMessage[] = [];
  for (const step of TERMS_WIZARD_V1.steps) {
    const opt = step.options.find((o) => !o.isCustom)!;
    const r = await flow.run({
      userId: "u-1",
      conversationId: conv.id,
      stepId: step.id,
      optionId: opt.id,
    });
    lastMessages = r.newMessages;
  }

  const totalSteps = TERMS_WIZARD_V1.steps.length;
  // Last assistant message must be the continue_cta to send.
  assertEquals(lastMessages[lastMessages.length - 1].kind, "continue_cta");
  const finalState = await conversations.getWizardState(conv.id);
  assertEquals(finalState?.activeStepIdx, totalSteps);
  assertEquals(finalState?.answers.length, totalSteps);

  await resetKv();
});

Deno.test("handle-wizard-answer integration: custom option records customValue in user-pick payload + state", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, conv, conversations } = await setupTermsConversation();

  // Step 1: customer create_new (isCustom)
  const r = await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    stepId: "customer",
    optionId: "create_new",
    customValue: "Tom & Linda K.",
  });

  assertEquals(r.newMessages[0].content, "Customer: Tom & Linda K.");
  const state = await conversations.getWizardState(conv.id);
  assertEquals(state?.answers[0].customValue, "Tom & Linda K.");

  await resetKv();
});

// --- problems.md #1/#19: customer-contact guard -----------------------------

/** Seed a real contractor User (so `users.get(userId)` resolves) and a terms
 *  conversation owned by them. */
async function setupTermsForRealUser(
  contact: { phoneNumber: string; email?: string },
) {
  const ctx = fresh();
  const user = await ctx.users.create({ phoneNumber: contact.phoneNumber });
  if (contact.email) await ctx.users.update(user.id, { email: contact.email });
  const conv = await ctx.conversations.create({ userId: user.id });
  await ctx.transitionFlow.run({ userId: user.id, conversationId: conv.id });
  return { ...ctx, user, conv };
}

Deno.test("handle-wizard-answer #1: rejects create_new whose email is the contractor's own (case-insensitive)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, user, conv } = await setupTermsForRealUser({
    phoneNumber: "+15403331334",
    email: "hans@example.com",
  });

  await assertRejects(
    () =>
      flow.run({
        userId: user.id,
        conversationId: conv.id,
        stepId: "customer",
        optionId: "create_new",
        customer: {
          create: { name: "Jane Doe", email: "  HANS@example.com " },
        },
      }),
    Error,
    "contractor's own",
  );
  await resetKv();
});

Deno.test("handle-wizard-answer #1: rejects create_new whose phone is the contractor's own (formatting-insensitive)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, user, conv } = await setupTermsForRealUser({
    phoneNumber: "+15403331334",
  });

  await assertRejects(
    () =>
      flow.run({
        userId: user.id,
        conversationId: conv.id,
        stepId: "customer",
        optionId: "create_new",
        customer: {
          create: { name: "Jane Doe", phoneNumber: "(540) 333-1334" },
        },
      }),
    Error,
    "contractor's own",
  );
  await resetKv();
});

Deno.test("handle-wizard-answer #1: allows create_new with a distinct customer contact", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, user, conv } = await setupTermsForRealUser({
    phoneNumber: "+15403331334",
    email: "hans@example.com",
  });

  const r = await flow.run({
    userId: user.id,
    conversationId: conv.id,
    stepId: "customer",
    optionId: "create_new",
    customer: {
      create: {
        name: "Jane Doe",
        email: "jane@client.com",
        phoneNumber: "+15125550000",
      },
    },
  });
  assertEquals(r.newMessages[0].content, "Customer: Jane Doe");
  await resetKv();
});

Deno.test("handle-wizard-answer integration: rejects answer when conversation is in 'quote' phase", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, flow } = fresh();
  const conv = await conversations.create({ userId: "u-1" }); // still in 'quote'
  await assertRejects(
    () =>
      flow.run({
        userId: "u-1",
        conversationId: conv.id,
        stepId: "customer",
        optionId: "use_active",
      }),
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
    () =>
      flow.run({
        userId: "u-1",
        conversationId: conv.id,
        stepId: "warranty",
        optionId: "12_months",
      }),
    Error,
    'expected answer for "customer"',
  );
  await resetKv();
});

Deno.test("handle-wizard-answer integration: out-of-order create_new does NOT create an orphan customer", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, customers, conv } = await setupTermsConversation();

  // Answer the customer step for real so the wizard advances to start_date.
  await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    stepId: "customer",
    optionId: "create_new",
    customer: { create: { name: "Real Cliente", phoneNumber: "+15125550001" } },
  });

  // A STALE card (second tab, double tap, lost-response retry) re-answers
  // the customer step. It must be rejected BEFORE the customer is
  // materialized — the old ordering wrote an orphan Customer row on every
  // failed attempt.
  await assertRejects(
    () =>
      flow.run({
        userId: "u-1",
        conversationId: conv.id,
        stepId: "customer",
        optionId: "create_new",
        customer: {
          create: { name: "Orphan Cliente", phoneNumber: "+15125550002" },
        },
      }),
    Error,
    'expected answer for "start_date"',
  );

  const list = await customers.listByUser("u-1");
  assertEquals(list.map((c) => c.name), ["Real Cliente"]);

  await resetKv();
});

Deno.test("handle-wizard-answer integration: forbidden across users", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, conv } = await setupTermsConversation("u-1");
  await assertRejects(
    () =>
      flow.run({
        userId: "u-2",
        conversationId: conv.id,
        stepId: "customer",
        optionId: "use_active",
      }),
    Error,
    "forbidden",
  );
  await resetKv();
});

Deno.test("handle-wizard-answer integration: completing all steps writes the terms onto conv.quoteId's quote", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, conv, quote, quotes } = await setupTermsConversationWithQuote();

  let lastResult;
  for (const step of TERMS_WIZARD_V1.steps) {
    const opt = step.options.find((o) => !o.isCustom)!;
    lastResult = await flow.run({
      userId: "u-1",
      conversationId: conv.id,
      stepId: step.id,
      optionId: opt.id,
    });
  }

  // The continue_cta carries the quote id (the quote IS the agreement).
  const cta = lastResult!.newMessages[lastResult!.newMessages.length - 1];
  const ctaPayload = cta.payload as { quoteId?: string; toPhase: string };
  assertEquals(
    ctaPayload.quoteId,
    quote.id,
    "continue_cta should carry quoteId",
  );

  // Terms are persisted onto the quote itself: one row per non-customer step,
  // stored in English with {stepId, label, value}. (Sorted — same-millisecond
  // message appends make the captured order non-deterministic.)
  const reloaded = await quotes.getOwned(quote.id, "u-1");
  const termStepIds = (reloaded.terms ?? []).map((t) => t.stepId).sort();
  assertEquals(
    termStepIds,
    ["payment_terms", "start_date", "warranty", "wraps"],
  );
  for (const term of reloaded.terms ?? []) {
    assert(term.label.length > 0, `term ${term.stepId} has a label`);
    assert(term.value.length > 0, `term ${term.stepId} has a value`);
  }
  // The conversation's customer is backfilled onto the quote.
  assertEquals(reloaded.customerId, "cust-1");

  await resetKv();
});

Deno.test("handle-wizard-answer integration: completing the wizard emits a quote 'terms_drafted' DomainEvent", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, conv, quote, bus } = await setupTermsConversationWithQuote();
  const seen: DomainEvent[] = [];
  bus.subscribe((e) => {
    if (e.entityType === "quote" && e.action === "terms_drafted") seen.push(e);
  });

  for (const step of TERMS_WIZARD_V1.steps) {
    const opt = step.options.find((o) => !o.isCustom)!;
    await flow.run({
      userId: "u-1",
      conversationId: conv.id,
      stepId: step.id,
      optionId: opt.id,
    });
  }

  assertEquals(seen.length, 1);
  assertEquals(seen[0].entityId, quote.id);
  assertEquals(seen[0].userId, "u-1");
  await resetKv();
});

Deno.test("handle-wizard-answer integration: completing the wizard without a bound quote does NOT throw and skips the terms persist", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, conv, bus } = await setupTermsConversation(); // no quoteId on conv
  const seen: DomainEvent[] = [];
  bus.subscribe((e) => {
    if (e.entityType === "quote" && e.action === "terms_drafted") seen.push(e);
  });

  let lastResult;
  for (const step of TERMS_WIZARD_V1.steps) {
    const opt = step.options.find((o) => !o.isCustom)!;
    lastResult = await flow.run({
      userId: "u-1",
      conversationId: conv.id,
      stepId: step.id,
      optionId: opt.id,
    });
  }

  const cta = lastResult!.newMessages[lastResult!.newMessages.length - 1];
  assertEquals(cta.kind, "continue_cta");
  // No quoteId on the cta payload, and no terms_drafted event fired.
  assertEquals((cta.payload as { quoteId?: string }).quoteId, undefined);
  assertEquals(seen.length, 0);

  await resetKv();
});

Deno.test("handle-wizard-answer integration: re-completing an already-finalized conversation re-writes the same terms idempotently", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, conversations, conv, quote, quotes } =
    await setupTermsConversationWithQuote();

  let lastResult;
  for (const step of TERMS_WIZARD_V1.steps) {
    const opt = step.options.find((o) => !o.isCustom)!;
    lastResult = await flow.run({
      userId: "u-1",
      conversationId: conv.id,
      stepId: step.id,
      optionId: opt.id,
    });
  }
  const firstQuoteId =
    (lastResult!.newMessages.at(-1)!.payload as { quoteId: string }).quoteId;
  const firstTerms = (await quotes.getOwned(quote.id, "u-1")).terms;

  // Roll the wizard back to its last step, then re-answer it. The
  // coordinator should re-finalize onto the SAME quote without
  // duplicating any terms rows.
  const rolledBackState = await conversations.getWizardState(conv.id);
  const totalSteps = TERMS_WIZARD_V1.steps.length;
  const lastIdx = totalSteps - 1;
  await conversations.putWizardState(conv.id, {
    ...rolledBackState!,
    activeStepIdx: lastIdx,
    answers: rolledBackState!.answers.slice(0, lastIdx),
  });

  const last = TERMS_WIZARD_V1.steps[lastIdx];
  const opt = last.options.find((o) => !o.isCustom)!;
  const r = await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    stepId: last.id,
    optionId: opt.id,
  });
  const secondQuoteId =
    (r.newMessages.at(-1)!.payload as { quoteId: string }).quoteId;

  assertEquals(secondQuoteId, firstQuoteId);
  const reloaded = await quotes.getOwned(quote.id, "u-1");
  assertEquals(reloaded.terms, firstTerms);

  await resetKv();
});
