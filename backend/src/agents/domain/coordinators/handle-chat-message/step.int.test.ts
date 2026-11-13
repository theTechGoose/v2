/**
 * REQ-392 (demo-loop cycle 2, M7; cycle 1 M9) — "No chat text box during parts
 * of the guided flow". The compact "Tell the assistant…" box on a guided step
 * sends its text with the step it was typed on, and HandleChatMessage honours
 * that hint:
 *
 *   price       → re-price: the pricing engine reads the correction beside the
 *                 job (never as a cost floor) and the reply carries the new
 *                 tiers + the price the contractor named, for the price box.
 *   job_details → the three versions are rewritten from the job, the version
 *                 on screen and the correction; the reply carries them.
 *   wizard      → the chat model answers with that question named; the step
 *                 stays unanswered.
 *   review      → the chat model treats it as a change to the quote (revise /
 *                 update_job_details / change_order) and the reply flags
 *                 quoteUpdated so the open review re-reads the quote.
 *
 * A step turn never runs the onboarding questions (the contractor is mid-flow).
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { t } from "@core/i18n/mod.ts";
import { HandleChatMessage } from "./mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { StubLLMClient } from "@agents/domain/business/llm/implementations/stub/mod.ts";
import type { LLMRequest } from "@agents/domain/business/llm/base/mod.ts";
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

const TYPED =
  "Master bath remodel for Maria Gutierrez in 78745. Tub out, curbless shower, 12x24 tile.";
const BULLETS = "Remove the tub\nBuild a curbless shower\nTile 12x24";
const DEMO_FIX =
  "No that's wrong, it's the WHOLE gut job incl. heated floor, vanity, glass, drain move — more like $28k";

async function seedOnboarded(userId: string) {
  const kv = await getKv();
  const now = new Date().toISOString();
  await kv.set(["user", userId], {
    id: userId,
    phoneNumber: "+15125550000",
    name: "Priya Nair",
    email: "priya@test.dev",
    language: "en",
    createdAt: now,
    updatedAt: now,
  });
  await new BusinessIdentityStore().upsert(userId, {
    businessName: "Nair Remodeling",
    acceptedPaymentMethods: { venmo: { enabled: true, handle: "@nair" } },
  });
  await new BusinessAddressStore().upsert(userId, {
    city: "Austin",
    state: "TX",
    postal: "78701",
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
  const emailer = new SendPaperworkEmail(
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
  );
  const alert = {
    run: () => Promise.resolve({ ok: true }),
  } as unknown as SendChangeOrderAlert;
  const flow = new HandleChatMessage(
    conversations,
    messages,
    quotes,
    new FileStore(),
    users,
    identity,
    new BusinessAddressStore(),
    new EventBus(),
    emailer,
    llm,
    new ApplyChatChangeOrder(
      quotes,
      invoices,
      new ChangeOrderStore(),
      customers,
      alert,
    ),
    new ReviseQuote(quotes, customers),
    undefined,
    customers,
  );
  return { conversations, messages, llm, quotes, flow };
}

/** Every request the stub saw, and a handler per kind of call. */
function record(
  llm: StubLLMClient,
  answer: (req: LLMRequest) => { text: string; action?: never } | {
    text: string;
    // deno-lint-ignore no-explicit-any
    action: any;
  },
): LLMRequest[] {
  const seen: LLMRequest[] = [];
  llm.setHandler((req) => {
    seen.push(req);
    return answer(req);
  });
  return seen;
}

const isPricing = (r: LLMRequest) =>
  r.responseFormat === "json" &&
  r.systemPrompt === t("en", "prompts.suggestPrices");
const isOptions = (r: LLMRequest) =>
  r.responseFormat === "json" &&
  r.systemPrompt === t("en", "prompts.generateJobOptions");
const userText = (r: LLMRequest) => r.messages.map((m) => m.content).join("\n");
/** REQ-710 (cycle 5, M4): TranslateBullets' call. */
const isTranslation = (r: LLMRequest) =>
  /You translate construction scope-of-work/.test(r.systemPrompt ?? "");

const TIERS_JSON = JSON.stringify({
  options: [
    { tier: "competitive", priceCents: 2_450_000, rationale: "Gut + floor" },
    { tier: "market", priceCents: 2_800_000, rationale: "Full scope" },
    { tier: "premium", priceCents: 3_200_000, rationale: "Expedited" },
  ],
});

// REQ-584 AMENDMENT (cycle 4, p4-p1d): three versions that differ by one
// token are near-twins and collapse to one card, so the fixture's versions
// really differ in how much they say (concise / standard / detailed).
const OPTION_BULLETS: Record<number, string[]> = {
  1: [
    "Tub out, curbless shower with a relocated drain",
    "Heated floor under 12x24 tile; vanity and frameless glass",
  ],
  2: [
    "Remove the tub and haul away debris",
    "Build a curbless shower with a relocated drain",
    "Install a heated floor under 12x24 tile",
    "Set the vanity and frameless glass",
  ],
  3: [
    "Remove the tub, disconnect supply lines and haul away all debris",
    "Cut the slab and relocate the drain for a curbless shower pan",
    "Waterproof the wet area and set 12x24 porcelain tile",
    "Install an electric heated floor mat with a programmable thermostat",
    "Set the vanity, connect plumbing and hang frameless glass",
  ],
};
const OPTION = (n: number) => ({
  en: {
    jobName: `Bath gut ${n}`,
    summary: `Master bath gut, version ${n}`,
    bullets: OPTION_BULLETS[n],
  },
});
const OPTIONS_JSON = JSON.stringify({
  options: [OPTION(1), OPTION(2), OPTION(3)],
});

Deno.test("REQ-392 M7 price step: a correction typed on Pick a price re-prices the job with it — tiers and the named price come back on the reply; no onboarding ask, no quote", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, messages, llm, quotes, flow } = fresh();
  // NOT onboarded: a plain turn would be answered with "what's your name?".
  const conv = await conversations.create({ userId: "u-1" });
  await messages.append({
    conversationId: conv.id,
    role: "user",
    kind: "text",
    content: TYPED,
  });
  const seen = record(
    llm,
    (r) => isPricing(r) ? { text: TIERS_JSON } : { text: "(chat model)" },
  );

  const res = await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: DEMO_FIX,
    step: { id: "price", job: TYPED, scope: BULLETS, tiers: true },
  });

  assertEquals(res.newMessages.length, 2);
  const [user, reply] = res.newMessages;
  assertEquals(user.role, "user");
  assertEquals(user.content, DEMO_FIX);
  assertEquals((user.payload as { step?: string }).step, "price");
  assertEquals(reply.role, "assistant");
  const p = reply.payload as {
    step?: string;
    priceSuggestions?: { options: { priceCents: number }[] };
    statedPriceCents?: number;
  };
  assertEquals(p.step, "price");
  assertEquals(
    p.priceSuggestions?.options.map((o) => o.priceCents),
    [2_450_000, 2_800_000, 3_200_000],
    "the re-priced tiers ride on the reply",
  );
  assertEquals(p.statedPriceCents, 2_800_000, "'more like $28k' → $28,000");
  assertStringIncludes(reply.content, "Market $28,000");
  assertStringIncludes(reply.content, "$28,000 in the price box");
  assert(
    !reply.content.includes(t("en", "onboarding.askName")),
    "no onboarding question mid-flow",
  );

  const pricing = seen.filter(isPricing);
  assertEquals(pricing.length, 1, "one pricing call");
  assertEquals(seen.length, 1, "no chat-model turn");
  const asked = userText(pricing[0]);
  assertStringIncludes(asked, TYPED);
  assertStringIncludes(asked, "Build a curbless shower");
  assertStringIncludes(asked, DEMO_FIX);

  assertEquals(await quotes.listByUser("u-1"), [], "pricing makes no quote");
  assertEquals((await conversations.get(conv.id)).quoteId, undefined);
  await resetKv();
});

Deno.test("REQ-392 M7 price step: the price named in a correction is the contractor's price, not a cost floor — the tiers are not lifted over it", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, flow } = fresh();
  await seedOnboarded("u-1");
  const conv = await conversations.create({ userId: "u-1" });
  const seen = record(llm, () => ({ text: TIERS_JSON }));

  const res = await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "it's the whole gut job, more like $28,000",
    step: { id: "price", job: TYPED, scope: BULLETS, tiers: true },
  });
  const p = res.newMessages[1].payload as {
    priceSuggestions?: { options: { priceCents: number }[] };
    statedPriceCents?: number;
  };
  assertEquals(
    p.priceSuggestions?.options.map((o) => o.priceCents),
    [2_450_000, 2_800_000, 3_200_000],
  );
  assertEquals(seen.filter(isPricing).length, 1, "no 'under the floor' re-ask");
  assertEquals(p.statedPriceCents, 2_800_000);
  await resetKv();
});

Deno.test("REQ-392 M7 price step: when the pricing engine can't re-price, the tiers on screen stay and the reply says so — the named price still fills the box", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, flow } = fresh();
  await seedOnboarded("u-1");
  const conv = await conversations.create({ userId: "u-1" });
  const seen = record(llm, () => ({ text: "sorry, not JSON" }));

  const res = await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "it's the whole gut job, more like $28k",
    step: { id: "price", job: TYPED, scope: BULLETS, tiers: true },
  });
  assertEquals(seen.filter(isPricing).length, 1, "it did try to re-price");
  const reply = res.newMessages[1];
  const p = reply.payload as {
    step?: string;
    priceSuggestions?: unknown;
    statedPriceCents?: number;
  };
  assertEquals(p.step, "price");
  assertEquals(
    p.priceSuggestions,
    undefined,
    "the engine's generic tiers never replace the ones on screen",
  );
  assertEquals(p.statedPriceCents, 2_800_000);
  assertStringIncludes(reply.content, "couldn't re-price");
  assertStringIncludes(reply.content, "$28,000 in the price box");
  await resetKv();
});

Deno.test("REQ-392 M7 price step (I know my price — no tiers on screen): the named price comes back for the box, with no pricing call", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, flow } = fresh();
  await seedOnboarded("u-1");
  const conv = await conversations.create({ userId: "u-1" });
  const seen = record(llm, () => ({ text: "(chat model)" }));

  const res = await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "no, my price is $4,500 total",
    step: { id: "price", job: "Fence repair, 40 ft", tiers: false },
  });
  const reply = res.newMessages[1];
  const p = reply.payload as {
    priceSuggestions?: unknown;
    statedPriceCents?: number;
  };
  assertEquals(p.statedPriceCents, 450_000);
  assertEquals(p.priceSuggestions, undefined);
  assertStringIncludes(reply.content, "$4,500 in the price box");
  assertEquals(seen.length, 0, "no model call at all");
  await resetKv();
});

Deno.test("REQ-392 M7 job-details step: the versions are rewritten from the job, the version on screen and the correction", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, flow } = fresh();
  await seedOnboarded("u-1");
  const conv = await conversations.create({ userId: "u-1" });
  const seen = record(
    llm,
    (r) => isOptions(r) ? { text: OPTIONS_JSON } : { text: "(chat model)" },
  );
  const fix =
    "add the heated floor, the vanity and the glass — and write it in Spanish too";

  const res = await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: fix,
    step: { id: "job_details", job: TYPED, scope: BULLETS },
  });
  const reply = res.newMessages[1];
  const p = reply.payload as {
    step?: string;
    jobOptions?: {
      options: { bullets: string[]; byLang?: Record<string, unknown> }[];
      degraded: boolean;
    };
  };
  assertEquals(p.step, "job_details");
  assertEquals(p.jobOptions?.options.length, 3);
  assertEquals(p.jobOptions?.degraded, false);
  assert(
    p.jobOptions?.options[0].bullets.some((b) => /heated floor/i.test(b)),
    "the rewritten versions carry the correction",
  );
  assertStringIncludes(reply.content, "Rewrote");

  const call = seen.filter(isOptions);
  assertEquals(call.length, 1);
  // REQ-710 AMENDMENT (cycle 5, M4): the writer answered in English only, so
  // the Spanish copies (the English, filled in) are sent to be translated
  // into Spanish — a translation, not a chat-model turn.
  const translations = seen.filter(isTranslation);
  assert(
    translations.length >= 1 &&
      translations.every((r) => /Spanish/.test(r.systemPrompt ?? "")),
    "the Spanish the writer left out is translated into Spanish",
  );
  assertEquals(
    seen.length - call.length - translations.length,
    0,
    "no chat-model turn",
  );
  const asked = userText(call[0]);
  assertStringIncludes(asked, TYPED);
  assertStringIncludes(asked, "Build a curbless shower");
  assertStringIncludes(asked, fix);
  assertStringIncludes(
    asked,
    `"es"`,
    "Spanish was asked for in the correction",
  );
  await resetKv();
});

Deno.test("REQ-392 M7 job-details step: when the writer can't be reached the versions on screen stay — nothing is built from the correction's framing", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, flow } = fresh();
  await seedOnboarded("u-1");
  const conv = await conversations.create({ userId: "u-1" });
  record(llm, () => ({ text: "sorry, not JSON" }));

  const res = await flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: "add the permit",
    step: { id: "job_details", job: TYPED, scope: BULLETS },
  });
  const reply = res.newMessages[1];
  const p = reply.payload as { step?: string; jobOptions?: unknown };
  assertEquals(p.step, "job_details");
  assertEquals(
    p.jobOptions,
    undefined,
    "no fallback versions replace the cards",
  );
  assertStringIncludes(reply.content, "couldn't");
  await resetKv();
});

/** A draft quote, a conversation bound to it, the hand-off into the terms
 *  wizard (the customer step is the open question). */
async function seedTerms(
  ctx: ReturnType<typeof fresh>,
): Promise<{ convId: string; quoteId: string }> {
  await seedOnboarded("u-1");
  const quote = await ctx.quotes.create("u-1", {
    summary: "Master bath remodel",
    description: BULLETS,
    lineItems: [{
      description: "Master bath remodel",
      quantity: 1,
      unit: "ea",
      price: 2_800_000,
    }],
    estimatedTotal: 2_800_000,
    status: "draft",
  });
  const conv = await ctx.conversations.create({
    userId: "u-1",
    quoteId: quote.id,
  });
  await new TransitionToTerms(ctx.conversations, ctx.messages).run({
    userId: "u-1",
    conversationId: conv.id,
  });
  return { convId: conv.id, quoteId: quote.id };
}

Deno.test("REQ-392 M7 wizard step: a question typed on 'Who is this for?' reaches the model with that step named — and the step stays open", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  const { convId } = await seedTerms(ctx);
  const before = await ctx.conversations.getWizardState(convId);
  const seen = record(ctx.llm, () => ({
    text: "Not yet — add her with + New customer below.",
  }));

  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: convId,
    content: "is Maria Gutierrez already one of my customers?",
    step: { id: "wizard", wizardStepId: "customer" },
  });

  assertEquals(seen.length, 1);
  const ctxText = `${seen[0].systemPrompt}\n${seen[0].businessContext ?? ""}`;
  assertStringIncludes(ctxText, t("en", "termsWizard.customer.label"));
  assertStringIncludes(ctxText, "stays on screen");
  assertEquals(
    res.newMessages[1].content,
    "Not yet — add her with + New customer below.",
  );
  const user = res.newMessages[0].payload as Record<string, unknown>;
  assertEquals(user.step, "wizard");
  assertEquals(user.wizardStepId, undefined, "never recorded as an answer");
  const after = await ctx.conversations.getWizardState(convId);
  assertEquals(after?.activeStepIdx, before?.activeStepIdx);
  assertEquals(after?.answers.length ?? 0, before?.answers.length ?? 0);
  await resetKv();
});

Deno.test("REQ-392 M7 review step: a change typed on Ready to send is a revision — revise_quote is offered and the new job details land on the quote, flagged for the review to re-read", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  const { convId, quoteId } = await seedTerms(ctx);
  const NEW_DETAILS =
    "Remove the tub\nBuild a curbless shower\nTile 12x24\nInstall a heated floor\nSet the vanity";
  const seen = record(ctx.llm, () => ({
    text: "Added the heated floor and the vanity.",
    action: {
      type: "update_job_details",
      payload: { descriptionByLang: { en: NEW_DETAILS } },
    },
  }));

  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: convId,
    content: "add the heated floor and the vanity",
    step: { id: "review" },
  });

  assertEquals(seen.length, 1);
  const tools = seen[0].tools ?? [];
  for (const tool of ["revise_quote", "update_job_details", "change_order"]) {
    assert(tools.includes(tool as never), `${tool} offered (${tools})`);
  }
  assert(!tools.includes("lock_quote" as never));
  assert(!tools.includes("create_quote" as never));
  assertStringIncludes(seen[0].businessContext ?? "", "Ready to send");
  const reply = res.newMessages.find((m) => m.role === "assistant")!;
  assertEquals(
    (reply.payload as { quoteUpdated?: string }).quoteUpdated,
    quoteId,
  );
  const quote = await ctx.quotes.getOwned(quoteId, "u-1");
  assertEquals(quote.description, NEW_DETAILS);
  await resetKv();
});

Deno.test("REQ-392 M7 review step: a priced item added to the bound draft flags quoteUpdated too, so the open review shows the new line", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  const { convId, quoteId } = await seedTerms(ctx);
  record(ctx.llm, () => ({
    text: "",
    action: {
      type: "change_order",
      payload: { description: "Heated floor", deltaAmountCents: 120_000 },
    },
  }));

  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: convId,
    content: "put the heated floor on it too, it's another twelve hundred",
    step: { id: "review" },
  });
  const reply = res.newMessages.find((m) => m.role === "assistant")!;
  assertEquals(
    (reply.payload as { quoteUpdated?: string }).quoteUpdated,
    quoteId,
  );
  const quote = await ctx.quotes.getOwned(quoteId, "u-1");
  assert(
    quote.lineItems.some((l) => l.description === "Heated floor"),
    JSON.stringify(quote.lineItems),
  );
  await resetKv();
});
