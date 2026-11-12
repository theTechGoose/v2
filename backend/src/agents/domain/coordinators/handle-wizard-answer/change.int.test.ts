/**
 * REQ-585 (demo-loop cycle 4, M4 + M30) — a term the contractor gives in the
 * chat re-answers the wizard through HandleWizardAnswer.change. Pair 7 picked
 * "Next month" on Q-002's start card, then typed "oops no, empezamos la
 * próxima semana, no el próximo mes" — nothing could change an answered step,
 * and "Start: Next month" stayed (fleet-6 stdout:251).
 *
 *   - the active step is answered exactly as a tap would (the next question
 *     follows);
 *   - an answered step is changed IN PLACE: its transcript pick (same id, same
 *     place), the wizard state's answer and the quote's terms — so back /
 *     rewind still pops the right pick;
 *   - a later step's preset is pre-selected for when the wizard gets there;
 *   - the same value changes nothing; a signed quote is refused, and a sent
 *     one's answered terms are left alone.
 */
import { assert, assertEquals } from "#std/assert";
import { HandleWizardAnswer } from "./mod.ts";
import { TransitionToTerms } from "@agents/domain/coordinators/transition-to-terms/mod.ts";
import { RewindWizard } from "@agents/domain/coordinators/rewind-wizard/mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

async function setup(status: "draft" | "sent" | "accepted" = "draft") {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const conversations = new AgentConversationStore();
  const messages = new AgentMessageStore();
  const quotes = new QuoteStore();
  const customers = new CustomerStore();
  const flow = new HandleWizardAnswer(
    conversations,
    messages,
    quotes,
    customers,
    new UserStore(),
    new EventBus(),
  );
  const customer = await customers.create("u-1", { name: "Linh Tran" });
  const quote = await quotes.create("u-1", {
    summary: "Baño principal",
    lineItems: [{
      description: "Baño principal",
      quantity: 1,
      unit: "ea",
      price: 1_800_000,
    }],
    estimatedTotal: 1_800_000,
    status: "draft",
  });
  const conv = await conversations.create({
    userId: "u-1",
    quoteId: quote.id,
    customerId: customer.id,
  });
  await new TransitionToTerms(conversations, messages).run({
    userId: "u-1",
    conversationId: conv.id,
  });
  const answer = (stepId: string, optionId: string, customValue?: string) =>
    flow.run({
      userId: "u-1",
      conversationId: conv.id,
      stepId,
      optionId,
      ...(customValue ? { customValue } : {}),
    });
  await answer("customer", "use_active");
  if (status !== "draft") {
    await quotes.update(quote.id, "u-1", {
      status,
      sentAt: "2026-11-12T15:00:00Z",
      ...(status === "accepted" ? { acceptedAt: "2026-11-12T16:00:00Z" } : {}),
    });
  }
  return { conversations, messages, quotes, flow, conv, quote, answer };
}

const change = (
  flow: HandleWizardAnswer,
  conversationId: string,
  stepId: string,
  optionId: string,
  customValue?: string,
) =>
  flow.change({
    userId: "u-1",
    conversationId,
    stepId,
    optionId,
    ...(customValue ? { customValue } : {}),
  });

Deno.test("REQ-585 HandleWizardAnswer.change: the active step is answered as a tap would — the pick, then the next question", async () => {
  const { flow, conv, conversations } = await setup();
  const r = await change(flow, conv.id, "start_date", "custom", "2026-11-23");
  assertEquals(r.kind, "answered");
  if (r.kind !== "answered") return;
  assertEquals(r.result.wizardState.activeStepIdx, 2);
  assertEquals(r.result.newMessages.map((m) => m.kind), ["text", "wizard"]);
  assertEquals(r.result.newMessages[0].content, "Start: Nov 23, 2026");
  const answered = (await conversations.getWizardState(conv.id))?.answers[1];
  assertEquals(
    [answered?.stepId, answered?.optionId, answered?.customValue],
    ["start_date", "custom", "2026-11-23"],
  );
  await resetKv();
});

Deno.test("REQ-585 M30 HandleWizardAnswer.change: pair 7's answered 'Next month' becomes 'Next week' in place — the pick (same id, same place), the state and the quote's terms; back still pops the right pick", async () => {
  const { flow, conv, conversations, messages, quotes, quote, answer } =
    await setup();
  await answer("start_date", "next_month");
  const before = await messages.listByConversation(conv.id);
  const oldPick = before.find((m) =>
    (m.payload as { wizardStepId?: string } | undefined)?.wizardStepId ===
      "start_date"
  )!;
  assertEquals(oldPick.content, "Start: Next month");

  const r = await change(flow, conv.id, "start_date", "next_week");
  assertEquals(r.kind, "changed");
  if (r.kind !== "changed") return;
  assertEquals(r.from, { optionId: "next_month" });
  assertEquals(r.to, { optionId: "next_week" });
  assertEquals(r.pick.id, oldPick.id, "the same pick, changed in place");
  assertEquals(r.pick.content, "Start: Next week");

  const after = await messages.listByConversation(conv.id);
  assertEquals(
    after.map((m) => m.id),
    before.map((m) => m.id),
    "nothing appended, nothing moved",
  );
  const pick = after.find((m) => m.id === oldPick.id)!;
  assertEquals(pick.content, "Start: Next week");
  assertEquals(
    (pick.payload as { optionId?: string }).optionId,
    "next_week",
  );
  const state = await conversations.getWizardState(conv.id);
  assertEquals(state?.activeStepIdx, 2, "still on the duration question");
  assertEquals(state?.answers[1].optionId, "next_week");
  const stored = await quotes.getOwned(quote.id, "u-1");
  assertEquals(
    stored.terms?.find((t) => t.stepId === "start_date")?.value,
    "Next week",
  );

  // Back from the duration question pops the start date and ITS pick.
  const back = await new RewindWizard(conversations, messages).run({
    userId: "u-1",
    conversationId: conv.id,
  });
  assertEquals(back.activeStepId, "start_date");
  assert(back.removedMessageIds.includes(oldPick.id), "the start pick went");
  assertEquals(back.previousAnswer?.optionId, "next_week");
  await resetKv();
});

Deno.test("REQ-585 HandleWizardAnswer.change: a later step's preset is pre-selected for when the wizard gets there; nothing else moves", async () => {
  const { flow, conv, conversations } = await setup();
  const r = await change(flow, conv.id, "payment_terms", "50_50");
  assertEquals(r.kind, "later");
  if (r.kind !== "later") return;
  assertEquals(r.prefilled, true);
  const c = await conversations.get(conv.id);
  assertEquals(c.termsPrefill?.payment_terms, "50_50");
  assertEquals((await conversations.getWizardState(conv.id))?.activeStepIdx, 1);
  // A later custom value can't be pre-selected — said, not stored.
  const custom = await change(flow, conv.id, "wraps", "custom", "2.5 weeks");
  assertEquals(custom.kind === "later" && custom.prefilled, false);
  await resetKv();
});

Deno.test("REQ-585 HandleWizardAnswer.change: the same value changes nothing", async () => {
  const { flow, conv, messages, answer } = await setup();
  await answer("start_date", "next_week");
  const before = await messages.listByConversation(conv.id);
  const r = await change(flow, conv.id, "start_date", "next_week");
  assertEquals(r.kind, "same");
  assertEquals(
    JSON.stringify(await messages.listByConversation(conv.id)),
    JSON.stringify(before),
  );
  await resetKv();
});

Deno.test("REQ-585 HandleWizardAnswer.change: a signed quote is refused; a sent quote's answered terms are left alone", async () => {
  const signed = await setup("accepted");
  const r = await change(
    signed.flow,
    signed.conv.id,
    "start_date",
    "next_week",
  );
  assertEquals(r.kind, "signed");
  assertEquals(
    (await signed.conversations.getWizardState(signed.conv.id))?.activeStepIdx,
    1,
  );

  const sent = await setup("sent");
  await sent.answer("start_date", "next_month");
  const s = await change(sent.flow, sent.conv.id, "start_date", "next_week");
  assertEquals(s.kind, "sent");
  const stored = await sent.quotes.getOwned(sent.quote.id, "u-1");
  assertEquals(
    stored.terms?.find((t) => t.stepId === "start_date")?.value,
    "Next month",
  );
  await resetKv();
});
