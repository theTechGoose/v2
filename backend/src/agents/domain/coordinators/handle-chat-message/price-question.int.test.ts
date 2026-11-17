/**
 * REQ-444 (demo-loop cycle 3, M21) — "The assistant ignores questions". On
 * Pick a price pair 7 typed "does this include the quartz slab material or
 * just labor?? … ¿y el precio incluye el permiso de plomería? add permit if
 * not" and got only "Re-priced with your note — Competitive $17,000 · Market
 * $20,000 · Premium $24,000." (fleet-6 stdout:194): REQ-392 sent every text
 * typed on that step to the pricing engine and answered with a template.
 *
 * Now HandleChatMessage classifies the text first. A question or a change to
 * the job reaches the chat model with the job, the details on screen and the
 * tiers on screen (and what they include); its answer is the reply. When it
 * rewrites the details (update_job_details — the only tool it gets here) the
 * tiers are re-priced for them and the reply carries the new details for the
 * step. Only a price correction still goes straight to the pricing engine.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { t } from "@core/i18n/mod.ts";
import { HandleChatMessage } from "./mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { StubLLMClient } from "@agents/domain/business/llm/implementations/stub/mod.ts";
import type {
  LLMRequest,
  LLMResponse,
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
import type { ChatStepHint } from "#quote-flow/step-composer.ts";

const TYPED =
  "Kitchen gut for the Hendersons at Barton Hills Dr: demo, IKEA shaker cabinets they buy (labor only), quartz top 48 sqft, subway tile backsplash 35 sqft, move the sink to the island";
const SCOPE = [
  "Demo existing kitchen",
  "Install shaker cabinets (customer-supplied, labor only)",
  "Install quartz countertop, 48 sq ft",
  "Subway tile backsplash, 35 sq ft",
  "New drain line thru slab to island (trench + patch)",
].join("\n");
const DEMO_QUESTION =
  "does this include the quartz slab material or just labor?? also 48 sqft of quartz. ¿y el precio incluye el permiso de plomería? add permit if not";
const ON_SCREEN = [
  {
    label: "Competitive",
    priceCents: 1_700_000,
    rationale: "Basic kitchen refresh",
  },
  {
    label: "Market",
    priceCents: 2_000_000,
    rationale: "Typical Austin kitchen remodel pricing",
  },
  { label: "Premium", priceCents: 2_400_000, rationale: "Top-tier finish" },
];
const STEP: ChatStepHint = {
  id: "price",
  job: TYPED,
  scope: SCOPE,
  tiers: true,
  options: ON_SCREEN,
  basis: "labor_materials_as_noted",
};
const REPRICED = JSON.stringify({
  options: [
    {
      tier: "competitive",
      priceCents: 1_750_000,
      rationale: "Refresh + permit",
    },
    { tier: "market", priceCents: 2_050_000, rationale: "Typical + permit" },
    { tier: "premium", priceCents: 2_450_000, rationale: "Top-tier + permit" },
  ],
});

async function seedOnboarded(userId: string, language = "en") {
  const kv = await getKv();
  const now = new Date().toISOString();
  await kv.set(["user", userId], {
    id: userId,
    phoneNumber: "+15125550106",
    name: "Priya Nair",
    email: "priya@test.dev",
    language,
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

const isPricing = (r: LLMRequest) =>
  r.responseFormat === "json" &&
  r.systemPrompt === t("en", "prompts.suggestPrices");
const said = (r: LLMRequest) => r.messages.map((m) => m.content).join("\n");

/** Every request the stub saw; the pricing engine and the chat model answered
 *  by their own handlers. */
function record(
  llm: StubLLMClient,
  chat: (req: LLMRequest) => LLMResponse,
  pricing: () => LLMResponse = () => ({ text: REPRICED }),
): LLMRequest[] {
  const seen: LLMRequest[] = [];
  llm.setHandler((req) => {
    seen.push(req);
    return isPricing(req) ? pricing() : chat(req);
  });
  return seen;
}

async function setup(language = "en") {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  await seedOnboarded("u-1", language);
  const conv = await ctx.conversations.create({ userId: "u-1" });
  await ctx.messages.append({
    conversationId: conv.id,
    role: "user",
    kind: "text",
    content: TYPED,
  });
  return { ...ctx, convId: conv.id };
}

type StepPayload = {
  step?: string;
  priceSuggestions?: { options: { priceCents: number }[] };
  statedPriceCents?: number;
  scope?: string;
  scopeByLang?: Record<string, string>;
};

Deno.test("REQ-444 M21 price step: the demo's question reaches the chat model with the job, the details and the tiers on screen — its answer is the reply; nothing is re-priced", async () => {
  const ctx = await setup();
  const ANSWER =
    "Labor only for the quartz — the slab material isn't in these prices. The permit isn't in the job details either.";
  const seen = record(ctx.llm, () => ({ text: ANSWER }));

  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: ctx.convId,
    content: DEMO_QUESTION,
    step: STEP,
  });

  assertEquals(seen.filter(isPricing).length, 0, "no re-price");
  assertEquals(seen.length, 1, "one chat-model turn");
  const req = seen[0];
  assertEquals(req.tools, ["update_job_details"], "only the details tool");
  const ctxText = req.businessContext ?? "";
  assertStringIncludes(ctxText, "Install quartz countertop, 48 sq ft");
  assertStringIncludes(ctxText, "Market $20,000");
  assertStringIncludes(ctxText, "Typical Austin kitchen remodel pricing");
  assertStringIncludes(
    ctxText,
    t("en", "suggestPrices.basis.laborMaterialsAsNoted"),
  );
  assertStringIncludes(ctxText, "Kitchen gut for the Hendersons");
  assertEquals(
    req.messages[req.messages.length - 1].content,
    DEMO_QUESTION,
    "the question is the model's last turn",
  );
  assertStringIncludes(req.systemPrompt, "update_job_details");

  assertEquals(res.newMessages.length, 2);
  const [user, reply] = res.newMessages;
  assertEquals((user.payload as { step?: string }).step, "price");
  assertStringIncludes(reply.content, ANSWER);
  assert(!reply.content.includes("Re-priced"), reply.content);
  // It asked to add the permit and the model changed nothing: said so.
  assertStringIncludes(
    reply.content,
    t("en", "chatCoordinator.step.scopeUnchanged"),
  );
  const p = reply.payload as StepPayload;
  assertEquals(p.step, "price", "the step takes the answer");
  assertEquals(p.priceSuggestions, undefined, "the tiers on screen stay");
  assertEquals(p.scope, undefined, "the details on screen stay");
  assertEquals(p.statedPriceCents, undefined);
  assertEquals(await ctx.quotes.listByUser("u-1"), [], "no quote is made");
  await resetKv();
});

Deno.test("REQ-444 M21 price step: 'add permit if not' — the model adds it to the details on screen, the tiers are re-priced for them, and the reply says what changed", async () => {
  const ctx = await setup();
  const NEW_SCOPE = `${SCOPE}\nPlumbing permit`;
  const seen = record(ctx.llm, () => ({
    text: "Labor only for the quartz. The permit wasn't included — I added it.",
    action: {
      type: "update_job_details",
      payload: { descriptionByLang: { en: NEW_SCOPE } },
    },
  }));

  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: ctx.convId,
    content: DEMO_QUESTION,
    step: STEP,
  });

  const pricing = seen.filter(isPricing);
  assertEquals(pricing.length, 1, "re-priced once, for the new details");
  assertStringIncludes(said(pricing[0]), "Plumbing permit");
  assertStringIncludes(said(pricing[0]), "Kitchen gut for the Hendersons");
  const reply = res.newMessages[1];
  const p = reply.payload as StepPayload;
  assertEquals(p.step, "price");
  assertEquals(p.scope, NEW_SCOPE, "the step shows the new details");
  assertEquals(p.scopeByLang, { en: NEW_SCOPE });
  assertEquals(
    p.priceSuggestions?.options.map((o) => o.priceCents),
    [1_750_000, 2_050_000, 2_450_000],
  );
  assertStringIncludes(reply.content, "Labor only for the quartz");
  assertStringIncludes(reply.content, "added Plumbing permit");
  assertStringIncludes(reply.content, "Market $20,500");
  assert(
    !reply.content.includes(t("en", "chatCoordinator.step.scopeUnchanged")),
    reply.content,
  );
  assertEquals(await ctx.quotes.listByUser("u-1"), [], "still no quote");
  await resetKv();
});

Deno.test("REQ-444 M21 price step: the price of an item being added never goes in the price box", async () => {
  const ctx = await setup();
  record(ctx.llm, () => ({
    text: "Added the permit.",
    action: {
      type: "update_job_details",
      payload: {
        descriptionByLang: { en: `${SCOPE}\nPlumbing permit ($450)` },
      },
    },
  }));
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: ctx.convId,
    content: "add the plumbing permit, it's $450",
    step: STEP,
  });
  const p = res.newMessages[1].payload as StepPayload;
  assertEquals(
    p.statedPriceCents,
    undefined,
    "$450 is the permit's, not the job's",
  );
  assertStringIncludes(p.scope ?? "", "Plumbing permit");
  await resetKv();
});

Deno.test("REQ-444 M21 price step: a question that names the job's price is answered, and that price fills the box", async () => {
  const ctx = await setup();
  const seen = record(ctx.llm, (req) => ({
    text: (req.businessContext ?? "").includes("$18,500")
      ? "Yes — $18,500 is in the price box; Continue uses it."
      : "Sure.",
  }));
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: ctx.convId,
    content: "can you make it $18,500?",
    step: STEP,
  });
  assertEquals(seen.filter(isPricing).length, 0);
  const reply = res.newMessages[1];
  assertStringIncludes(reply.content, "$18,500 is in the price box");
  assertEquals((reply.payload as StepPayload).statedPriceCents, 1_850_000);
  await resetKv();
});

Deno.test("REQ-444 M21 price step: when the chat model can't be reached the reply says so — the tiers and the details on screen stay", async () => {
  const ctx = await setup();
  ctx.llm.setHandler(() => {
    throw new Error("upstream timeout");
  });
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: ctx.convId,
    content: "is the quartz material included?",
    step: STEP,
  });
  const reply = res.newMessages[1];
  assertEquals(reply.content, t("en", "chatCoordinator.step.askFailed"));
  const p = reply.payload as StepPayload;
  assertEquals(p.step, "price");
  assertEquals(p.priceSuggestions, undefined);
  assertEquals(p.scope, undefined);
  await resetKv();
});

Deno.test("REQ-444 M21 price step (Spanish contractor): the model is told to answer in Spanish, and the server's own lines are Spanish", async () => {
  const ctx = await setup("es");
  const seen = record(ctx.llm, () => ({
    text: "Agregué el permiso de plomería.",
    action: {
      type: "update_job_details",
      payload: {
        descriptionByLang: { es: "Demoler la cocina\nPermiso de plomería" },
      },
    },
  }));
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: ctx.convId,
    content: "¿incluye el permiso de plomería? agrégalo si no",
    step: { ...STEP, scope: "Demoler la cocina" },
  });
  const chat = seen.find((r) => !isPricing(r))!;
  assertStringIncludes(
    chat.systemPrompt,
    t("en", "prompts.contractorLanguageEsOverride"),
  );
  const reply = res.newMessages[1];
  assertStringIncludes(reply.content, "agregué Permiso de plomería");
  assertEquals(
    (reply.payload as StepPayload).scope,
    "Demoler la cocina\nPermiso de plomería",
  );
  await resetKv();
});

Deno.test("REQ-444 M21 price step: a plain price correction still goes to the pricing engine alone (REQ-392)", async () => {
  const ctx = await setup();
  const seen = record(ctx.llm, () => ({ text: "(chat model)" }));
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: ctx.convId,
    content: "that's too low, it's the whole gut job — more like $28k",
    step: STEP,
  });
  assertEquals(seen.length, 1);
  assert(isPricing(seen[0]), "the pricing engine, not the chat model");
  const p = res.newMessages[1].payload as StepPayload;
  assertEquals(p.statedPriceCents, 2_800_000);
  assertStringIncludes(res.newMessages[1].content, "Re-priced");
  await resetKv();
});

// ---------------------------------------------------------------------------
// REQ-658 (demo-loop cycle 5, M17 + m51): "how did you get 17,500? 85/hr +
// cost+15%, break down labor vs materials... make it around 18k" got "I
// couldn't answer that just now, so nothing changed — ask me again." with a
// 200 — and that line became the thread's sidebar preview. "break down labor
// vs materials please" only re-priced the tiers.
// ---------------------------------------------------------------------------

const BREAKDOWN_DEMO =
  "how did you get 17,500? 85/hr + cost+15%, break down labor vs materials... make it around 18k";

Deno.test("REQ-658 m51 price step: 'break down labor vs materials please' reaches the chat model with a breakdown brief — never the re-pricer", async () => {
  const ctx = await setup();
  const ANSWER =
    "Market $20,000: about $9,000 labor and $11,000 materials (estimates).";
  const seen = record(ctx.llm, () => ({ text: ANSWER }));
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: ctx.convId,
    content: "break down labor vs materials please",
    step: STEP,
  });
  assertEquals(seen.filter(isPricing).length, 0, "no re-price");
  assertEquals(seen.length, 1);
  const brief = (seen[0].businessContext ?? "").toLowerCase();
  assertStringIncludes(brief, "hourly rate");
  assertStringIncludes(brief, "markup");
  const reply = res.newMessages[1];
  assertStringIncludes(reply.content, ANSWER);
  assert(!reply.content.includes("Re-priced"), reply.content);
  assertEquals((reply.payload as StepPayload).priceSuggestions, undefined);
  await resetKv();
});

Deno.test("REQ-658 M17 price step: the demo's message keeps its stated $18,000 and the rate rides to the model", async () => {
  const ctx = await setup();
  const seen = record(
    ctx.llm,
    () => ({ text: "At $85/hr that's about 90 hours of labor…" }),
  );
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: ctx.convId,
    content: BREAKDOWN_DEMO,
    step: STEP,
  });
  assertEquals(seen.filter(isPricing).length, 0);
  assertEquals(
    seen[0].messages[seen[0].messages.length - 1].content,
    BREAKDOWN_DEMO,
    "the contractor's rate and markup reach the model",
  );
  assertStringIncludes(seen[0].businessContext ?? "", "$18,000");
  const p = res.newMessages[1].payload as StepPayload;
  assertEquals(p.statedPriceCents, 1_800_000);
  await resetKv();
});

Deno.test("REQ-658 M17 price step: an empty model answer is re-asked once — the second answer is the reply", async () => {
  const ctx = await setup();
  const ANSWER =
    "Labor ≈ $8,500 at your $85/hr; materials ≈ $9,500 with your 15%.";
  let n = 0;
  const seen = record(ctx.llm, () => ({ text: n++ === 0 ? "" : ANSWER }));
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: ctx.convId,
    content: "break down labor vs materials please",
    step: STEP,
  });
  assertEquals(seen.filter((r) => !isPricing(r)).length, 2, "asked twice");
  const reply = res.newMessages[1];
  assertEquals(reply.content, ANSWER);
  assertEquals(res.conversation.preview?.includes("Labor"), true);
  await resetKv();
});

Deno.test("REQ-658 M17 price step: when the model answers nothing twice, the fallback is honest and never becomes the thread's preview", async () => {
  const ctx = await setup();
  const before = (await ctx.conversations.get(ctx.convId))?.preview;
  const seen = record(ctx.llm, () => ({ text: "" }));
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: ctx.convId,
    content: "break down labor vs materials please",
    step: STEP,
  });
  assertEquals(seen.filter((r) => !isPricing(r)).length, 2, "re-asked once");
  const reply = res.newMessages[1];
  assertEquals(reply.content, t("en", "chatCoordinator.step.askEmpty"));
  assert(
    !reply.content.includes("couldn't answer that just now"),
    reply.content,
  );
  assertEquals(res.conversation.preview, before, "preview unchanged");
  assert(
    !(res.conversation.preview ?? "").includes(reply.content),
    "the fallback is never the summary",
  );
  await resetKv();
});

Deno.test("REQ-658 M17 price step: a model call that throws is not written to the thread's preview either", async () => {
  const ctx = await setup();
  const before = (await ctx.conversations.get(ctx.convId))?.preview;
  ctx.llm.setHandler(() => {
    throw new Error("upstream 500");
  });
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: ctx.convId,
    content: "is the permit included?",
    step: STEP,
  });
  assertEquals(
    res.newMessages[1].content,
    t("en", "chatCoordinator.step.askFailed"),
  );
  assertEquals(res.conversation.preview, before, "preview unchanged");
  await resetKv();
});
