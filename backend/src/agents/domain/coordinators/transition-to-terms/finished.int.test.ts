/**
 * REQ-368 (demo-loop cycle 1, M32) — TransitionToTerms on a conversation
 * whose terms wizard is already FINISHED. Pair 1 clicked "Person" on a stale
 * "Is this for a business or a person?" CTA after John signed, and got a
 * wizard bubble reading "All terms answered." with no options — a dead end,
 * while the deposit invoice had already gone out. A finished wizard now hands
 * back the step it ends on: the review/send CTA for a quote not sent yet, or
 * where the bill stands once the quote is issued.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { TransitionToTerms } from "./mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { wizardSpecFor } from "@agents/domain/business/terms-wizard-spec/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

function fresh() {
  const conversations = new AgentConversationStore();
  const messages = new AgentMessageStore();
  const flow = new TransitionToTerms(conversations, messages);
  return {
    conversations,
    messages,
    flow,
    quotes: new QuoteStore(),
    invoices: new InvoiceStore(),
  };
}

async function finishedWizard(
  fx: ReturnType<typeof fresh>,
  quoteId: string,
) {
  const conv = await fx.conversations.create({
    userId: "u-1",
    quoteId,
    currentPhase: "terms",
  });
  const spec = wizardSpecFor("quote");
  await fx.conversations.putWizardState(conv.id, {
    specId: spec.id,
    activeStepIdx: spec.steps.length,
    answers: [],
  });
  return conv;
}

Deno.test("REQ-368 M32 transition-to-terms: a finished wizard on a SIGNED quote answers with the deposit invoice — never 'All terms answered.'", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const fx = fresh();
  const quote = await fx.quotes.create("u-1", {
    summary: "Repaint 3 Bedrooms and Hallway",
    lineItems: [{
      description: "Repaint",
      quantity: 1,
      unit: "ea",
      price: 320_000,
    }],
    estimatedTotal: 320_000,
    status: "accepted",
    acceptedName: "John Miller",
  });
  const deposit = await fx.invoices.create("u-1", {
    quoteId: quote.id,
    amount: 160_000,
    dueDate: "2026-11-19",
    status: "sent",
    installmentIndex: 1,
    installmentTotal: 2,
  });
  const conv = await finishedWizard(fx, quote.id);

  const res = await fx.flow.run({ userId: "u-1", conversationId: conv.id });

  const all = res.newMessages.map((m) => m.content).join("\n");
  assert(!all.includes("All terms answered."), all);
  assertEquals(res.newMessages.filter((m) => m.kind === "wizard").length, 0);
  assertStringIncludes(all, deposit.number!);
  assertStringIncludes(all, "$1,600");
  const card = res.newMessages.find((m) => m.kind === "action_card");
  assertEquals(
    (card?.payload as { invoiceId?: string } | undefined)?.invoiceId,
    deposit.id,
  );
  await resetKv();
});

Deno.test("REQ-368 M32 transition-to-terms: a finished wizard on a quote not sent yet re-offers the review/send step", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const fx = fresh();
  const quote = await fx.quotes.create("u-1", {
    summary: "Repaint",
    lineItems: [{
      description: "Repaint",
      quantity: 1,
      unit: "ea",
      price: 320_000,
    }],
    status: "draft",
  });
  const conv = await finishedWizard(fx, quote.id);

  const res = await fx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    lang: "es",
  });

  assertEquals(res.newMessages.length, 1);
  const cta = res.newMessages[0];
  assertEquals(cta.kind, "continue_cta");
  const p = cta.payload as { toPhase?: string; quoteId?: string };
  assertEquals(p.toPhase, "send");
  assertEquals(p.quoteId, quote.id);
  assert(!cta.content.includes("Todos los términos respondidos"), cta.content);
  await resetKv();
});

Deno.test("REQ-368 transition-to-terms: an UNFINISHED wizard still re-emits its current step", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const fx = fresh();
  const conv = await fx.conversations.create({
    userId: "u-1",
    currentPhase: "terms",
  });
  const spec = wizardSpecFor("quote");
  await fx.conversations.putWizardState(conv.id, {
    specId: spec.id,
    activeStepIdx: 1,
    answers: [],
  });

  const res = await fx.flow.run({ userId: "u-1", conversationId: conv.id });

  assertEquals(res.newMessages.length, 1);
  assertEquals(res.newMessages[0].kind, "wizard");
  assertEquals((res.newMessages[0].payload as { stepIdx?: number }).stepIdx, 1);
  await resetKv();
});
