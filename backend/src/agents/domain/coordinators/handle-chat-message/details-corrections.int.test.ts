/**
 * REQ-653 (demo-loop cycle 5, M7 + m50) — Raphael: "fix every issue the demo
 * found, loop until there are none."
 *
 *   m50 — the agreement said "Finish before Thanksgiving" next to start
 *         "Right away" + "3 weeks" (ends Dec 3); "its NOT done before
 *         thanksgiving if we start now + 3 wks, fix that" got "I didn't change
 *         the start date — ask me again" (fleet-6 stdout:207/225).
 *   M7  — "same address" left Q-002 with no job address (fleet-4
 *         stdout:216); "email notanemail" was ignored without a word
 *         (fleet-9 stdout:37).
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { HandleChatMessage } from "./mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { StubLLMClient } from "@agents/domain/business/llm/implementations/stub/mod.ts";
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

const textReplies = (
  msgs: { role: string; kind: string; content: string }[],
) => msgs.filter((m) => m.role === "assistant" && m.kind === "text");

const pad = (n: number) => String(n).padStart(2, "0");
const isoIn = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** A draft bound to a conversation in the terms phase: customer answered,
 *  start "Right away", time to complete `wraps` (custom). */
async function termsDraft(ctx: Ctx, wraps = "3 weeks", first?: string) {
  await seedOnboarded("u-1");
  const customer = await ctx.customers.create("u-1", {
    name: "The Hendersons",
  });
  const quote = await ctx.quotes.create("u-1", {
    summary: "Master Bath & Kitchen",
    jobName: "Master Bath & Kitchen",
    description: "Gut master bath 8x10\nKitchen backsplash 30sqft subway",
    lineItems: [{
      description: "Master bath",
      quantity: 1,
      unit: "ea",
      price: 1_875_000,
    }],
    estimatedTotal: 1_875_000,
    status: "draft",
    customerId: customer.id,
  });
  const conv = await ctx.conversations.create({
    userId: "u-1",
    quoteId: quote.id,
    customerId: customer.id,
  });
  if (first) {
    await ctx.messages.append({
      conversationId: conv.id,
      role: "user",
      kind: "text",
      content: first,
    });
  }
  await new TransitionToTerms(ctx.conversations, ctx.messages).run({
    userId: "u-1",
    conversationId: conv.id,
  });
  const run = (stepId: string, optionId: string, customValue?: string) =>
    ctx.wizard.run({
      userId: "u-1",
      conversationId: conv.id,
      stepId,
      optionId,
      ...(customValue ? { customValue } : {}),
    });
  await run("customer", "use_active");
  await run("start_date", "asap");
  const last = await run("wraps", "custom", wraps);
  return { convId: conv.id, quoteId: quote.id, last };
}

Deno.test("REQ-653 m50: 'its NOT done before thanksgiving if we start now + 3 wks, fix that' → the reply checks the schedule against the deadline, never 'I didn't change the start date'", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  const { convId } = await termsDraft(ctx);
  ctx.llm.setHandler(() => ({ text: "" }) as never);
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: convId,
    content:
      "oh and its NOT done before thanksgiving if we start now + 3 wks, fix that",
    step: { id: "wizard", wizardStepId: "payment_terms" },
  });
  const reply = textReplies(res.newMessages).map((m) => m.content).join(" ");
  assertStringIncludes(reply, "deadline");
  assert(!reply.includes("I didn't change the start date"), reply);
  await resetKv();
});

Deno.test("REQ-653 m50: a deadline the schedule misses is said with the end day and what to change", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  const { convId } = await termsDraft(ctx);
  ctx.llm.setHandler(() => ({ text: "" }) as never);
  const due = isoIn(7);
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: convId,
    content: `it has to be finished by ${due}`,
    step: { id: "wizard", wizardStepId: "payment_terms" },
  });
  const reply = textReplies(res.newMessages).map((m) => m.content).join(" ");
  assertStringIncludes(reply, "misses the deadline");
  assertStringIncludes(reply, "Right away");
  assertStringIncludes(reply, "3 weeks");
  await resetKv();
});

Deno.test("REQ-653 m50: update_terms with only a finishBy is accepted — the reply checks it, nothing is refused", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  const { convId } = await termsDraft(ctx);
  ctx.llm.setHandler(() =>
    ({
      text: "",
      action: { type: "update_terms", payload: { finishBy: `by ${isoIn(7)}` } },
    }) as never
  );
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: convId,
    content: "we need to wrap this up quick, the client has a party",
    step: { id: "wizard", wizardStepId: "payment_terms" },
  });
  const reply = textReplies(res.newMessages).map((m) => m.content).join(" ");
  assertStringIncludes(reply, "misses the deadline");
  await resetKv();
});

Deno.test("REQ-653 m50: the deadline typed in the first message is checked when the wizard's time to complete is answered", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  const { last } = await termsDraft(
    ctx,
    "3 weeks",
    `kitchen backsplash 30sqft subway — client wants it done by ${isoIn(7)}`,
  );
  const said = textReplies(last.newMessages).map((m) => m.content).join(" ");
  assertStringIncludes(said, "misses the deadline");
  await resetKv();
});

Deno.test("REQ-653 M7: 'same address' fills the job address from the customer's last quote", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  await seedOnboarded("u-1");
  const dana = await ctx.customers.create("u-1", { name: "Dana Whitfield" });
  await ctx.quotes.create("u-1", {
    summary: "Kitchen Remodel",
    jobName: "Kitchen Remodel",
    lineItems: [{
      description: "Kitchen",
      quantity: 1,
      unit: "ea",
      price: 1_540_000,
    }],
    estimatedTotal: 1_540_000,
    status: "sent",
    customerId: dana.id,
    serviceAddress: "1800 Barton Hills Dr, Austin, TX 78704",
  });
  ctx.llm.setHandler(() =>
    ({
      text: "",
      action: {
        type: "create_quote",
        payload: {
          summary: "Guest bathroom refresh — Dana Whitfield",
          lineItems: [{
            description: "Guest bathroom refresh",
            amountCents: 570_000,
          }],
        },
      },
    }) as never
  );
  const conv = await ctx.conversations.create({ userId: "u-1" });
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content:
      "second quote for Dana Whitfield, guest bathroom refresh, same address, $5,700",
  });
  const card = res.newMessages.find((m) => m.kind === "action_card");
  assert(card, "a quote card");
  const quoteId = (card!.payload as { quoteId: string }).quoteId;
  const q = await ctx.quotes.getOwned(quoteId, "u-1");
  assertEquals(q.serviceAddress, "1800 Barton Hills Dr, Austin, TX 78704");
  await resetKv();
});

Deno.test("REQ-653 M7: 'email notanemail' is said to be skipped — never ignored", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  await seedOnboarded("u-1");
  ctx.llm.setHandler(() =>
    ({
      text: "",
      action: {
        type: "create_quote",
        payload: {
          summary: "Panel upgrade — Bob Miller",
          lineItems: [{ description: "Panel upgrade", amountCents: 185_000 }],
        },
      },
    }) as never
  );
  const conv = await ctx.conversations.create({ userId: "u-1" });
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "panel upgrade for Bob Miller, $1,850, email notanemail",
  });
  const reply = textReplies(res.newMessages).map((m) => m.content).join(" ");
  assertStringIncludes(reply, "notanemail");
  assertStringIncludes(reply, "skipped");
  await resetKv();
});
