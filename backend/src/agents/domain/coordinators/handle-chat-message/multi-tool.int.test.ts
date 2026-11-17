/**
 * REQ-444 (demo-loop cycle 3, M21) — "says changes are done when they are
 * not". On Ready to send pair 7 sent one long EN+ES fix: correct the Spanish
 * job details AND "add a plumbing permit line $450". The reply was "Done — the
 * job details on the quote are updated."; the Spanish gained "Permiso de
 * plomería", but no line was priced and the total stayed $20,000 (fleet-6
 * stdout:209). OpenAILLMClient kept only the model's first tool call, and the
 * update_job_details branch answered with a fixed "Done" whatever changed.
 *
 * Now every change the model made runs — the job details first, then each
 * line change in its order — and the one reply is built from what actually
 * changed: the details' languages and lines, each line change's own words and
 * the total's move. A change that moved no price on a message that named an
 * amount says the total is unchanged. A mix that can't all run says what it
 * didn't do.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { t } from "@core/i18n/mod.ts";
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

const EN_DETAILS = [
  "Demo existing kitchen",
  "Install shaker cabinets (customer-supplied, labor only)",
  "Install quartz countertop, 48 sq ft",
  "New drain line thru slab to island (trench + patch)",
].join("\n");
const ES_DETAILS = [
  "Demoler la cocina existente",
  "Instalar gabinetes shaker (los compra el cliente, solo mano de obra)",
  "Instalar encimera de cuarzo, 48 pies cuadrados",
].join("\n");
const EN_FIXED = `${EN_DETAILS}\nQuartz material included\nPlumbing permit`;
const ES_FIXED = [
  ES_DETAILS,
  "Nueva línea de drenaje por la losa hasta la isla (zanja + parche)",
  "Material de cuarzo incluido",
  "Permiso de plomería",
].join("\n");
const DEMO_FIX =
  "Fix the Spanish: the drain line is missing (zanja, not trinchado). Quartz material IS included, say so. And add a plumbing permit line $450 / agrega el permiso de plomería";

const DETAILS: LLMAction = {
  type: "update_job_details",
  payload: { descriptionByLang: { en: EN_FIXED, es: ES_FIXED } },
};
const PERMIT: LLMAction = {
  type: "change_order",
  payload: { description: "Plumbing permit", deltaAmountCents: 45_000 },
};

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
  const flow = new HandleChatMessage(
    conversations,
    messages,
    quotes,
    new FileStore(),
    users,
    identity,
    new BusinessAddressStore(),
    new EventBus(),
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
  );
  return { conversations, messages, llm, quotes, flow };
}

/** The demo's quote on Ready to send: Q-001 Kitchen Renovation & Cleanup,
 *  $20,000, English + Spanish job details, the wizard under way. */
async function readyToSend(ctx: ReturnType<typeof fresh>, phase = "terms") {
  await seedOnboarded("u-1");
  const quote = await ctx.quotes.create("u-1", {
    summary: "Kitchen Renovation & Cleanup",
    jobName: "Kitchen Renovation & Cleanup",
    description: EN_DETAILS,
    descriptionByLang: { en: EN_DETAILS, es: ES_DETAILS },
    lineItems: [{
      description: "Kitchen Renovation & Cleanup",
      quantity: 1,
      unit: "ea",
      price: 2_000_000,
    }],
    estimatedTotal: 2_000_000,
    status: "draft",
  });
  const conv = await ctx.conversations.create({
    userId: "u-1",
    quoteId: quote.id,
  });
  if (phase === "terms") {
    await new TransitionToTerms(ctx.conversations, ctx.messages).run({
      userId: "u-1",
      conversationId: conv.id,
    });
  }
  return { convId: conv.id, quoteId: quote.id };
}

function answer(
  llm: StubLLMClient,
  res: {
    text: string;
    action?: LLMAction;
    actions?: LLMAction[];
    dropped?: string[];
  },
): LLMRequest[] {
  const seen: LLMRequest[] = [];
  llm.setHandler((req) => {
    seen.push(req);
    // deno-lint-ignore no-explicit-any
    return res as any;
  });
  return seen;
}

const OLD_DONE = "Done — the job details on the quote are updated.";

Deno.test("REQ-444 M21 review step: the demo's fix — the job details (en + es) AND the $450 permit both land; one reply says what changed and the new total, never 'Done — …'", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  const { convId, quoteId } = await readyToSend(ctx);
  const seen = answer(ctx.llm, {
    text: "",
    action: DETAILS,
    actions: [DETAILS, PERMIT],
  });

  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: convId,
    content: DEMO_FIX,
    step: { id: "review" },
  });

  assertEquals(seen.length, 1);
  assertStringIncludes(
    seen[0].systemPrompt + (seen[0].businessContext ?? ""),
    "one tool call for each change",
  );
  const quote = await ctx.quotes.getOwned(quoteId, "u-1");
  assertEquals(quote.descriptionByLang?.es, ES_FIXED, "the Spanish fix landed");
  assertEquals(quote.descriptionByLang?.en, EN_FIXED);
  const permit = quote.lineItems.find((l) =>
    l.description === "Plumbing permit"
  );
  assertEquals(permit?.price, 45_000, "the $450 permit is a priced line");
  assertEquals(quote.estimatedTotal, 2_045_000, "the total moved");

  const replies = res.newMessages.filter((m) => m.role === "assistant");
  assertEquals(replies.length, 1, "one reply");
  const reply = replies[0];
  assert(reply.content !== OLD_DONE, reply.content);
  assertStringIncludes(
    reply.content,
    "Updated the job details (English, Spanish)",
  );
  assertStringIncludes(reply.content, "Plumbing permit ($450.00)");
  assertStringIncludes(reply.content, "Total $20,000.00 → $20,450.00.");
  const p = reply.payload as {
    quoteUpdated?: string;
    changeOrder?: { kind: string; quoteId?: string };
  };
  assertEquals(p.quoteUpdated, quoteId, "the open review re-reads the quote");
  assertEquals(p.changeOrder?.kind, "draft_updated");
  assertEquals(p.changeOrder?.quoteId, quoteId);
  await resetKv();
});

Deno.test("REQ-444 multi-tool: the job details go first, whatever order the model made the calls in", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  const { convId, quoteId } = await readyToSend(ctx);
  answer(ctx.llm, { text: "", action: PERMIT, actions: [PERMIT, DETAILS] });
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: convId,
    content: DEMO_FIX,
    step: { id: "review" },
  });
  const reply = res.newMessages.find((m) => m.role === "assistant")!;
  const details = reply.content.indexOf("Updated the job details");
  const added = reply.content.indexOf("Plumbing permit ($450.00)");
  assert(details >= 0 && added > details, reply.content);
  const quote = await ctx.quotes.getOwned(quoteId, "u-1");
  assertEquals(quote.estimatedTotal, 2_045_000);
  assertEquals(quote.descriptionByLang?.es, ES_FIXED);
  await resetKv();
});

Deno.test("REQ-444 multi-tool: two priced items in one message are both added, and the total says so", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  const { convId, quoteId } = await readyToSend(ctx);
  const DUMPSTER: LLMAction = {
    type: "change_order",
    payload: { description: "20 yd dumpster", deltaAmountCents: 60_000 },
  };
  answer(ctx.llm, { text: "", action: PERMIT, actions: [PERMIT, DUMPSTER] });
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: convId,
    content: "add a plumbing permit $450 and a 20 yd dumpster $600",
    step: { id: "review" },
  });
  const quote = await ctx.quotes.getOwned(quoteId, "u-1");
  assertEquals(
    quote.lineItems.map((l) => [l.description, l.price]),
    [
      ["Kitchen Renovation & Cleanup", 2_000_000],
      ["Plumbing permit", 45_000],
      ["20 yd dumpster", 60_000],
    ],
  );
  const reply = res.newMessages.find((m) => m.role === "assistant")!;
  assertStringIncludes(reply.content, "Plumbing permit ($450.00)");
  assertStringIncludes(reply.content, "20 yd dumpster ($600.00)");
  assertStringIncludes(reply.content, "Total $20,000.00 → $21,050.00.");
  await resetKv();
});

Deno.test("REQ-444 M21 review step: only the job details changed although the message named $450 — the reply says no price changed and the total is still $20,000", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  const { convId, quoteId } = await readyToSend(ctx);
  answer(ctx.llm, { text: "", action: DETAILS });
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: convId,
    content: DEMO_FIX,
    step: { id: "review" },
  });
  const quote = await ctx.quotes.getOwned(quoteId, "u-1");
  assertEquals(quote.descriptionByLang?.es, ES_FIXED);
  assertEquals(quote.estimatedTotal, 2_000_000);
  const reply = res.newMessages.find((m) => m.role === "assistant")!;
  assert(reply.content !== OLD_DONE, reply.content);
  assertStringIncludes(
    reply.content,
    "Updated the job details (English, Spanish): added Quartz material included, Plumbing permit.",
  );
  assertStringIncludes(
    reply.content,
    t("en", "chatCoordinator.jobDetails.pricesSame", {
      total: "$20,000.00",
    }),
  );
  assertEquals(
    (reply.payload as { quoteUpdated?: string }).quoteUpdated,
    quoteId,
  );
  await resetKv();
});

Deno.test("REQ-444: a job-details change with no amount named is said from what changed — no price line", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  const { convId } = await readyToSend(ctx);
  answer(ctx.llm, {
    text: "",
    action: {
      type: "update_job_details",
      payload: { descriptionByLang: { es: ES_FIXED } },
    },
  });
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: convId,
    content: "the Spanish is missing the drain line, fix it",
    step: { id: "review" },
  });
  const reply = res.newMessages.find((m) => m.role === "assistant")!;
  assertEquals(reply.content, "Updated the job details (Spanish).");
  await resetKv();
});

Deno.test("REQ-444: a mix that can't all run — the first call runs as before and the reply names what it didn't do", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  // Quote phase, an open draft bound: every tool is offered.
  const { convId, quoteId } = await readyToSend(ctx, "quote");
  answer(ctx.llm, {
    text: "",
    action: PERMIT,
    actions: [PERMIT, { type: "lock_quote", payload: { quoteId } }],
  });
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: convId,
    content: "add a plumbing permit for $450 and then lock it in",
  });
  const quote = await ctx.quotes.getOwned(quoteId, "u-1");
  assert(
    quote.lineItems.some((l) => l.description === "Plumbing permit"),
    "the first call ran",
  );
  assertEquals(quote.lockedAt, undefined, "the lock did not");
  const reply = res.newMessages.find((m) =>
    m.role === "assistant" && m.kind === "text"
  )!;
  assertStringIncludes(reply.content, "Plumbing permit ($450.00)");
  assertStringIncludes(
    reply.content,
    t("en", "chatCoordinator.tool.lock_quote"),
  );
  assertStringIncludes(reply.content, "ask me again");
  await resetKv();
});

Deno.test("REQ-444: a call whose arguments didn't parse is named in the reply instead of passing for done", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  const { convId, quoteId } = await readyToSend(ctx);
  answer(ctx.llm, {
    text: "",
    action: DETAILS,
    actions: [DETAILS],
    dropped: ["change_order"],
  });
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: convId,
    content: DEMO_FIX,
    step: { id: "review" },
  });
  const quote = await ctx.quotes.getOwned(quoteId, "u-1");
  assertEquals(quote.estimatedTotal, 2_000_000);
  const reply = res.newMessages.find((m) => m.role === "assistant")!;
  assertStringIncludes(reply.content, "Updated the job details");
  assertStringIncludes(
    reply.content,
    t("en", "chatCoordinator.tool.change_order"),
  );
  assertStringIncludes(reply.content, "ask me again");
  await resetKv();
});
