/**
 * REQ-663 (demo-loop cycle 5, m40 + p18-7c) — the chat model re-sends the
 * job's current terms through update_terms on a message that asks about none
 * of them.
 *
 *   m40    — "Linda also wants the hallway painted, add $400 change order" on
 *            a signed agreement answered three "The agreement is signed, so I
 *            can't change …" lines (fleet-0 stdout:254).
 *   p18-7c — "… its NOT done before thanksgiving…fix that" answered "The
 *            payment terms is already 50/50." (fleet-6 stdout:331): an
 *            unasked term, and "is" on a plural.
 *
 * A pick for a term the message never names is dropped; a term it names gets
 * its line, worded for a plural term.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { HandleChatMessage } from "./mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { StubLLMClient } from "@agents/domain/business/llm/implementations/stub/mod.ts";
import type {
  LLMAction,
  LLMRequest,
} from "@agents/domain/business/llm/base/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { FileStore } from "@files/domain/data/file-store/mod.ts";
import { BusinessAddressStore } from "@profile/domain/data/business-address-store/mod.ts";
import { SendPaperworkEmail } from "@paperwork/domain/coordinators/send-paperwork-email/mod.ts";
import { EmailService } from "@communication/domain/data/email-service/mod.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { ConversationStore as CommConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore as CommMessageStore } from "@communication/domain/data/message-store/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";
import { ChangeOrderStore } from "@paperwork/domain/data/change-order-store/mod.ts";
import type { SendChangeOrderAlert } from "@paperwork/domain/coordinators/send-change-order-alert/mod.ts";
import { ApplyChatChangeOrder } from "@agents/domain/coordinators/apply-chat-change-order/mod.ts";
import { ReviseQuote } from "@agents/domain/coordinators/revise-quote/mod.ts";
import { TransitionToTerms } from "@agents/domain/coordinators/transition-to-terms/mod.ts";
import { HandleWizardAnswer } from "@agents/domain/coordinators/handle-wizard-answer/mod.ts";

async function seedOnboarded(userId: string) {
  const kv = await getKv();
  const now = new Date().toISOString();
  await kv.set(["user", userId], {
    id: userId,
    phoneNumber: "+15125550106",
    name: "Priya Nair",
    email: "priya@test.dev",
    language: "en",
    createdAt: now,
    updatedAt: now,
  });
  await new BusinessIdentityStore().upsert(userId, {
    businessName: "Nair Kitchen & Bath",
    acceptedPaymentMethods: { check: { enabled: true } },
  });
  await new BusinessAddressStore().upsert(userId, {
    city: "Austin",
    state: "TX",
    postal: "78704",
  });
}

function fresh() {
  const conversations = new AgentConversationStore();
  const messages = new AgentMessageStore();
  const llm = new StubLLMClient();
  const quotes = new QuoteStore();
  const invoices = new InvoiceStore();
  const customers = new CustomerStore();
  const users = new UserStore();
  const identity = new BusinessIdentityStore();
  const email = new EmailService();
  email.send = () => Promise.resolve({ ok: true, reason: "test_capture" });
  const bus = new EventBus();
  const wizard = new HandleWizardAnswer(
    conversations,
    messages,
    quotes,
    customers,
    users,
    bus,
  );
  const flow = new HandleChatMessage(
    conversations,
    messages,
    quotes,
    new FileStore(),
    users,
    identity,
    new BusinessAddressStore(),
    bus,
    new SendPaperworkEmail(
      quotes,
      invoices,
      customers,
      users,
      identity,
      email,
      new LogPaperworkMessage(
        new CommConversationStore(),
        new CommMessageStore(),
      ),
    ),
    llm,
    new ApplyChatChangeOrder(
      quotes,
      invoices,
      new ChangeOrderStore(),
      customers,
      {
        run: () => Promise.resolve({ ok: true }),
      } as unknown as SendChangeOrderAlert,
    ),
    new ReviseQuote(quotes, customers),
    undefined,
    customers,
    undefined,
    undefined, // REQ-583's ChatBilling
    wizard,
  );
  return { conversations, messages, llm, quotes, customers, wizard, flow };
}

type Ctx = ReturnType<typeof fresh>;

/** A draft quote bound to a conversation. `terms`: the wizard under way, the
 *  customer answered (and `answered` steps after it). */
async function boundDraft(
  ctx: Ctx,
  q: {
    summary: string;
    description?: string;
    descriptionByLang?: Record<string, string>;
    lines: [string, number][];
  },
  opts: { terms?: boolean; answered?: [string, string][] } = {},
) {
  await seedOnboarded("u-1");
  const customer = await ctx.customers.create("u-1", {
    name: "Carol Henderson",
  });
  const quote = await ctx.quotes.create("u-1", {
    summary: q.summary,
    jobName: q.summary,
    ...(q.description ? { description: q.description } : {}),
    ...(q.descriptionByLang ? { descriptionByLang: q.descriptionByLang } : {}),
    lineItems: q.lines.map(([description, price]) => ({
      description,
      quantity: 1,
      unit: "ea",
      price,
    })),
    estimatedTotal: q.lines.reduce((s, [, p]) => s + p, 0),
    status: "draft",
    customerId: customer.id,
  });
  const conv = await ctx.conversations.create({
    userId: "u-1",
    quoteId: quote.id,
    customerId: customer.id,
  });
  if (opts.terms) {
    await new TransitionToTerms(ctx.conversations, ctx.messages).run({
      userId: "u-1",
      conversationId: conv.id,
    });
    await ctx.wizard.run({
      userId: "u-1",
      conversationId: conv.id,
      stepId: "customer",
      optionId: "use_active",
    });
    for (const [stepId, optionId] of opts.answered ?? []) {
      await ctx.wizard.run({
        userId: "u-1",
        conversationId: conv.id,
        stepId,
        optionId,
      });
    }
  }
  return { convId: conv.id, quoteId: quote.id };
}

function answer(
  llm: StubLLMClient,
  res: { text: string; action?: LLMAction; actions?: LLMAction[] },
): LLMRequest[] {
  const seen: LLMRequest[] = [];
  llm.setHandler((req) => {
    seen.push(req);
    // deno-lint-ignore no-explicit-any
    return res as any;
  });
  return seen;
}

const textReplies = (
  msgs: { role: string; kind: string; content: string }[],
) => msgs.filter((m) => m.role === "assistant" && m.kind === "text");

/** All three terms answered (Next week · 2 weeks · 50/50). */
const ANSWERED: [string, string][] = [
  ["start_date", "next_week"],
  ["wraps", "2_weeks"],
  ["payment_terms", "50_50"],
];

/** The echo the demo model sent: the job's terms as they already are. */
const ECHO: LLMAction = {
  type: "update_terms",
  payload: {
    startDate: "next week",
    duration: "2 weeks",
    paymentTerms: "50/50",
  },
};

Deno.test("REQ-663 m40: 'add $400 change order' on a signed agreement with update_terms re-sending the current terms → no 'can't change' line for any term, nothing on the quote changes", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  const { convId, quoteId } = await boundDraft(ctx, {
    summary: "Living Room Painting",
    lines: [["Living room painting", 145_000]],
  }, { terms: true, answered: ANSWERED });
  await ctx.quotes.update(quoteId, "u-1", {
    status: "accepted",
    acceptedAt: new Date().toISOString(),
    acceptedName: "Linda Johnson",
  });
  const before = await ctx.conversations.getWizardState(convId);
  answer(ctx.llm, {
    text: "",
    action: ECHO,
    actions: [ECHO],
  });
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: convId,
    content: "Linda also wants the hallway painted, add $400 change order",
  });
  const all = res.newMessages.map((m) => m.content).join(" | ");
  assert(!all.includes("can't change"), all);
  assert(!all.includes("didn't change"), all);
  assert(!all.includes("already"), all);
  assertEquals(
    (await ctx.conversations.getWizardState(convId))?.answers,
    before?.answers,
  );
  await resetKv();
});

Deno.test("REQ-663 p18-7c: 'its NOT done before thanksgiving…fix that' with the payment terms re-sent unchanged → no payment line at all; the named time to complete still gets its line", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  const { convId } = await boundDraft(ctx, {
    summary: "Master Bath & Kitchen",
    lines: [["Master bath and kitchen", 1_875_000]],
  }, { terms: true, answered: ANSWERED });
  const echo: LLMAction = {
    type: "update_terms",
    payload: { duration: "2 weeks", paymentTerms: "50_50" },
  };
  answer(ctx.llm, { text: "", action: echo, actions: [echo] });
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: convId,
    content: "oh and its NOT done before thanksgiving…fix that",
  });
  const reply = textReplies(res.newMessages).map((m) => m.content).join(" | ");
  assert(!reply.includes("payment terms"), reply);
  assert(!reply.includes(" is already 50/50"), reply);
  assertStringIncludes(reply, "The time to complete is already 2 weeks.");
  await resetKv();
});

Deno.test("REQ-663 p18-7c: a message that names the payment terms, re-sent as they are → 'The payment terms are already 50/50.'", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  const { convId } = await boundDraft(ctx, {
    summary: "Master Bath & Kitchen",
    lines: [["Master bath and kitchen", 1_875_000]],
  }, { terms: true, answered: ANSWERED });
  const pay: LLMAction = {
    type: "update_terms",
    payload: { paymentTerms: "50_50" },
  };
  answer(ctx.llm, { text: "", action: pay, actions: [pay] });
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: convId,
    content: "make the payment 50/50",
  });
  const reply = textReplies(res.newMessages).map((m) => m.content).join(" | ");
  assertStringIncludes(reply, "The payment terms are already 50/50.");
  await resetKv();
});

Deno.test("REQ-663: a term the message does name still changes (the gate drops only unasked picks)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  const { convId } = await boundDraft(ctx, {
    summary: "Master Bath & Kitchen",
    lines: [["Master bath and kitchen", 1_875_000]],
  }, { terms: true, answered: ANSWERED });
  const both: LLMAction = {
    type: "update_terms",
    payload: { duration: "1 week", paymentTerms: "due_now" },
  };
  answer(ctx.llm, { text: "", action: both, actions: [both] });
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: convId,
    content: "make it 1 week",
  });
  const reply = textReplies(res.newMessages).map((m) => m.content).join(" | ");
  assertStringIncludes(
    reply,
    "Changed the time to complete: 2 weeks → 1 week.",
  );
  assert(!reply.includes("payment"), reply);
  const state = await ctx.conversations.getWizardState(convId);
  assertEquals(
    state?.answers.find((a) => a.stepId === "payment_terms")?.optionId,
    "50_50",
  );
  assertEquals(
    state?.answers.find((a) => a.stepId === "wraps")?.optionId,
    "1_week",
  );
  await resetKv();
});
