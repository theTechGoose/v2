/**
 * REQ-585 (demo-loop cycle 4, M4 + M30) — "The assistant ignores requests,
 * says it changed things it did not, or contradicts itself" and "A Spanish
 * edit dumps the whole raw message into the job scope".
 *
 *   pair 5 — "give Derek a second option … so he can pick one?" → the model
 *            re-sent the same line; the reply was "Updated the quote." over
 *            an identical card (fleet-4 stdout:55/121).
 *   pair 6 — "Quote para Carmen Ruiz … Ella habla español." → create_quote +
 *            update_job_details; a correct Q-001 card sat under "Todavía no
 *            pude actualizar los detalles del trabajo…" (fleet-5 stdout:231).
 *   pair 7 — on the start-date card "we start monday nov 23 … is 50% normal in
 *            texas?" got an answer to her Pick-a-price request ("…I couldn't
 *            find a line called "Floor stays (LVP is new)"…"); a cabinet
 *            rewording got "added …; removed … I couldn't find a line called
 *            … so I changed nothing"; "oops no, empezamos la próxima semana
 *            … y agrega 1,500 …" echoed her whole message twice and left
 *            "Start: Next month"; "the start should be next week … what should
 *            I charge for the heated floor?" answered the price only
 *            (fleet-6 stdout:226/234/251/254).
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
import { formatTermDate } from "#quote-flow/format-helpers.ts";

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

// ---------------------------------------------------------------------------
// pair 5 — an option ask over the same lines
// ---------------------------------------------------------------------------

Deno.test("REQ-585 M4 pair 5: 'a second option … so he can pick one?' re-sent with the same line → 'Nothing on the quote changed' and that a quote can't hold options — never 'Updated the quote.'", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  const { convId, quoteId } = await boundDraft(ctx, {
    summary: "Bathroom vanity swap — Derek Chen",
    lines: [["36in vanity", 225_000]],
  });
  answer(ctx.llm, {
    text: "",
    action: {
      type: "create_quote",
      payload: {
        summary: "Bathroom vanity swap — Derek Chen",
        lineItems: [{ description: "36in vanity", amountCents: 225_000 }],
      },
    },
  });
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: convId,
    content:
      "Can you also give Derek a second option with a 48in double vanity for $2,900 so he can pick one?",
  });
  const replies = textReplies(res.newMessages);
  assertEquals(replies.length, 1, JSON.stringify(res.newMessages));
  const reply = replies[0].content;
  assert(!reply.includes("Updated the quote"), reply);
  assertStringIncludes(reply, "Nothing on the quote changed");
  assertStringIncludes(reply, "can't hold options");
  const quote = await ctx.quotes.getOwned(quoteId, "u-1");
  assertEquals(quote.estimatedTotal, 225_000);
  await resetKv();
});

// ---------------------------------------------------------------------------
// pair 6 — create_quote + update_job_details in one turn
// ---------------------------------------------------------------------------

const CARMEN_ES =
  "Reparar fuga del grifo de la cocina\nColgar 2 puertas interiores";

Deno.test("REQ-585 M4 pair 6: create_quote + update_job_details ('Ella habla español') → the draft carries the Spanish job details, and no 'Todavía no pude…' line sits under the card", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  await seedOnboarded("u-1");
  const conv = await ctx.conversations.create({ userId: "u-1" });
  const create: LLMAction = {
    type: "create_quote",
    payload: {
      summary: "Reparación de grifo y colgado de puertas — Carmen Ruiz",
      lineItems: [
        {
          description: "Reparación de fuga del grifo de la cocina",
          amountCents: 22_500,
        },
        { description: "Colgar 2 puertas interiores", amountCents: 22_500 },
      ],
    },
  };
  const details: LLMAction = {
    type: "update_job_details",
    payload: { descriptionByLang: { es: CARMEN_ES } },
  };
  answer(ctx.llm, { text: "", action: create, actions: [create, details] });
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content:
      "Quote para Carmen Ruiz: fix leaky faucet en la cocina y colgar 2 puertas interiores, $450 todo incluido. Ella habla español.",
  });
  const card = res.newMessages.find((m) => m.kind === "action_card");
  assert(card, "the draft card");
  for (const m of textReplies(res.newMessages)) {
    assert(!m.content.includes("Todavía no pude"), m.content);
    assert(!m.content.includes("pídemelo otra vez"), m.content);
  }
  const quoteId = (card!.payload as { quoteId: string }).quoteId;
  const quote = await ctx.quotes.getOwned(quoteId, "u-1");
  assertEquals(quote.descriptionByLang?.es, CARMEN_ES);
  assertEquals(quote.description, CARMEN_ES, "the reply language's copy");
  assertEquals(quote.estimatedTotal, 45_000);
  await resetKv();
});

// ---------------------------------------------------------------------------
// pair 7 — the start-date card
// ---------------------------------------------------------------------------

const HENDERSON = [
  "Full kitchen gut, 12×14",
  "Installation of new white shaker cabinets from cabinet place on Burnet",
  "Quartz countertops",
].join("\n");

/** Nov 23 as the server reads "monday nov 23" today: this year's, or next
 *  year's once it has passed. */
function nov23(): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const y = new Date(now.getFullYear(), 10, 23) < today
    ? now.getFullYear() + 1
    : now.getFullYear();
  return `${y}-11-23`;
}

Deno.test("REQ-585 M4 pair 7: on the start-date card 'we start monday nov 23 … 50% deposit … is 50% normal in texas?' → the start is Nov 23 (the next question follows), 50/50 waits on the payment step, the question's answer stays — and the old Pick-a-price request is never replayed", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  await seedOnboarded("u-1");
  // The thread before the quote: the job, then a Pick-a-price request that
  // was applied there (its reply carries the step).
  const conv0 = await ctx.conversations.create({ userId: "u-1" });
  await ctx.messages.append({
    conversationId: conv0.id,
    role: "user",
    kind: "text",
    content:
      "Henderson kitchen gut, Carol, Ridgewood Dr Austin. Floor stays (LVP is new).",
  });
  await ctx.messages.append({
    conversationId: conv0.id,
    role: "user",
    kind: "text",
    content:
      "these seem low?? also take out the floor stays line. ¿y el depósito del 50% está bien?",
    payload: { step: "price" },
  });
  await ctx.messages.append({
    conversationId: conv0.id,
    role: "assistant",
    kind: "text",
    content:
      "Updated the job details: removed Floor stays (LVP is new). Re-priced — Competitive $28,500 · Market $32,500 · Premium $37,500.",
    payload: { step: "price", scope: HENDERSON },
  });
  const customer = await ctx.customers.create("u-1", {
    name: "Carol Henderson",
  });
  const quote = await ctx.quotes.create("u-1", {
    summary: "Henderson Kitchen Gut",
    jobName: "Henderson Kitchen Gut",
    description: HENDERSON,
    lineItems: [{
      description: "Detailed kitchen gut and remodel",
      quantity: 1,
      unit: "ea",
      price: 3_800_000,
    }],
    estimatedTotal: 3_800_000,
    status: "draft",
    customerId: customer.id,
  });
  await ctx.conversations.update(conv0.id, {
    quoteId: quote.id,
    customerId: customer.id,
  });
  await new TransitionToTerms(ctx.conversations, ctx.messages).run({
    userId: "u-1",
    conversationId: conv0.id,
  });
  await ctx.wizard.run({
    userId: "u-1",
    conversationId: conv0.id,
    stepId: "customer",
    optionId: "use_active",
  });

  const terms: LLMAction = {
    type: "update_terms",
    payload: { startDate: "monday nov 23", paymentTerms: "50_50" },
  };
  const seen = answer(ctx.llm, {
    text:
      "Done — I set the start date to Nov 23. Yes — a 50% deposit is common for kitchen remodels in Texas.",
    action: terms,
    actions: [terms],
  });
  const MSG =
    "we start monday nov 23. and I want a 50% deposit upfront, rest when done. is 50% normal in texas?";
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: conv0.id,
    content: MSG,
    step: { id: "wizard", wizardStepId: "start_date" },
  });

  // The model was offered update_terms, told about it, and never saw the
  // already-applied Pick-a-price turn.
  assertEquals(seen.length, 1);
  assert(
    seen[0].tools?.includes("update_terms"),
    JSON.stringify(seen[0].tools),
  );
  assertStringIncludes(
    seen[0].systemPrompt + (seen[0].businessContext ?? ""),
    "update_terms",
  );
  const sent = seen[0].messages.map((m) => m.content).join("\n");
  assert(!sent.includes("take out the floor stays line"), sent);
  assert(!sent.includes("removed Floor stays"), sent);
  assertStringIncludes(sent, MSG);

  // The start date is answered as a tap would; the duration question is next.
  const iso = nov23();
  const state = await ctx.conversations.getWizardState(conv0.id);
  assertEquals(state?.activeStepIdx, 2);
  assertEquals(
    [
      state?.answers[1].stepId,
      state?.answers[1].optionId,
      state?.answers[1].customValue,
    ],
    ["start_date", "custom", iso],
  );
  const kinds = res.newMessages.map((m) => m.kind);
  assertEquals(
    kinds,
    ["text", "text", "wizard", "text"],
    JSON.stringify(kinds),
  );
  assertEquals(
    res.newMessages[1].content,
    `Start: ${formatTermDate(iso, "en")}`,
  );
  assertEquals(
    (res.newMessages[2].payload as { stepId?: string }).stepId,
    "wraps",
  );
  const stored = await ctx.quotes.getOwned(quote.id, "u-1");
  assertEquals(
    stored.terms?.find((t) => t.stepId === "start_date")?.value,
    iso,
  );
  assertEquals(
    (await ctx.conversations.get(conv0.id)).termsPrefill?.payment_terms,
    "50_50",
  );

  const reply = res.newMessages[3].content;
  assertStringIncludes(
    reply,
    `Set the start date to ${formatTermDate(iso, "en")}.`,
  );
  assertStringIncludes(reply, "50/50");
  assertStringIncludes(
    reply,
    "a 50% deposit is common for kitchen remodels in Texas.",
  );
  assert(!reply.includes("Done — I set"), reply);
  assert(!reply.includes("couldn't find a line"), reply);
  assert(!reply.includes("already say that"), reply);
  assertEquals(
    (res.newMessages[3].payload as { quoteUpdated?: string }).quoteUpdated,
    quote.id,
  );
  await resetKv();
});

// ---------------------------------------------------------------------------
// pair 7 — the cabinet rewording: a job-details bullet is not a priced line
// ---------------------------------------------------------------------------

const HENDERSON_FIXED = HENDERSON.replace(
  "Installation of new white shaker cabinets from cabinet place on Burnet",
  "Installation of new white shaker cabinets",
);

Deno.test("REQ-585 M4 pair 7: 'change the cabinet line to just say white shaker cabinets' made with update_job_details AND a revise_quote on the old bullet → one consistent reply, never 'I couldn't find a line … so I changed nothing'", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  const { convId, quoteId } = await boundDraft(ctx, {
    summary: "Henderson Kitchen Gut",
    description: HENDERSON,
    descriptionByLang: { en: HENDERSON },
    lines: [["Detailed kitchen gut and remodel", 3_800_000]],
  }, {
    terms: true,
    answered: [["start_date", "next_week"], ["wraps", "2_weeks"], [
      "payment_terms",
      "50_50",
    ], ["warranty", "12_months"]],
  });
  const details: LLMAction = {
    type: "update_job_details",
    payload: {
      descriptionByLang: {
        en: HENDERSON_FIXED,
        es:
          "Demolición completa de la cocina, 12×14\nInstalación de gabinetes shaker blancos nuevos\nEncimeras de cuarzo",
      },
    },
  };
  const revise: LLMAction = {
    type: "revise_quote",
    payload: {
      lines: [{
        match:
          "Installation of new white shaker cabinets from cabinet place on Burnet",
        description: "Installation of new white shaker cabinets",
      }],
      remove: [],
    },
  };
  answer(ctx.llm, { text: "", action: details, actions: [details, revise] });
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: convId,
    content:
      "Carol's husband Miguel only reads spanish, can you send this to them in Spanish? also change the cabinet line to just say white shaker cabinets, no store name",
    step: { id: "review" },
  });
  const replies = textReplies(res.newMessages);
  assertEquals(replies.length, 1);
  const reply = replies[0].content;
  assertStringIncludes(reply, "Updated the job details (English, Spanish)");
  assert(!reply.includes("couldn't find a line"), reply);
  assert(!reply.includes("changed nothing"), reply);
  const quote = await ctx.quotes.getOwned(quoteId, "u-1");
  assertEquals(quote.description, HENDERSON_FIXED);
  assertEquals(
    quote.lineItems.map((l) => [l.description, l.price]),
    [["Detailed kitchen gut and remodel", 3_800_000]],
  );
  await resetKv();
});

Deno.test("REQ-585 M4: a revise_quote alone on a job-details bullet says that wording is in the job details — not 'I couldn't find a line called …'", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  const { convId, quoteId } = await boundDraft(ctx, {
    summary: "Henderson Kitchen Gut",
    description: HENDERSON,
    lines: [["Detailed kitchen gut and remodel", 3_800_000]],
  }, { terms: true });
  answer(ctx.llm, {
    text: "",
    action: {
      type: "revise_quote",
      payload: {
        lines: [{
          match: "cabinets from cabinet place on Burnet",
          description: "Installation of new white shaker cabinets",
        }],
        remove: [],
      },
    },
  });
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: convId,
    content: "change the cabinet line to just say white shaker cabinets",
    step: { id: "review" },
  });
  const reply = textReplies(res.newMessages)[0].content;
  assert(!reply.includes("I couldn't find a line called"), reply);
  assertStringIncludes(reply, "job details");
  const quote = await ctx.quotes.getOwned(quoteId, "u-1");
  assertEquals(quote.estimatedTotal, 3_800_000);
  await resetKv();
});

// ---------------------------------------------------------------------------
// pair 7 — Q-002: the Spanish correction on a one-line job, an answered start
// ---------------------------------------------------------------------------

const RAW_ES =
  "Baño principal de la señora Tran en Round Rock, quitar la tina y poner regadera de azulejo con banca, vanity doble, el inodoro se queda pero lo reinstalamos, dos semanas y media, ponle precio, no sé, como 18 mil?";

Deno.test("REQ-585 M30 pair 7: 'oops no, empezamos la próxima semana, no el próximo mes. y agrega 1,500 por la calefacción del piso' → her message is never echoed, the answered start changes Next month → Next week, the $1,500 lands", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  const { convId, quoteId } = await boundDraft(ctx, {
    summary: "Baño principal de la señora Tran",
    description: RAW_ES,
    lines: [["Baño principal de la señora Tran en Round", 1_800_000]],
  }, { terms: true, answered: [["start_date", "next_month"]] });
  const details: LLMAction = {
    type: "update_job_details",
    payload: {
      descriptionByLang: {
        es: `${
          RAW_ES.replace("como 18 mil?", "como 19,500?")
        } Calefacción del piso.`,
      },
    },
  };
  const terms: LLMAction = {
    type: "update_terms",
    payload: { startDate: "la próxima semana" },
  };
  const floor: LLMAction = {
    type: "change_order",
    payload: { description: "Calefacción del piso", deltaAmountCents: 150_000 },
  };
  answer(ctx.llm, {
    text: "",
    action: details,
    actions: [details, terms, floor],
  });
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: convId,
    content:
      "oops no, empezamos la próxima semana, no el próximo mes. y agrega 1,500 por la calefacción del piso",
    step: { id: "wizard", wizardStepId: "wraps" },
  });
  const replies = textReplies(res.newMessages);
  assertEquals(replies.length, 1, JSON.stringify(res.newMessages));
  const reply = replies[0].content;
  assert(!reply.includes("señora Tran en Round Rock, quitar"), reply);
  assert(!reply.includes("agregué Baño"), reply);
  assert(!reply.includes(".."), reply);
  assertStringIncludes(reply, "Actualicé los detalles del trabajo (español).");
  assertStringIncludes(
    reply,
    "Cambié la fecha de inicio: El próximo mes → La próxima semana.",
  );
  assertStringIncludes(reply, "Calefacción del piso");
  assertStringIncludes(reply, "$19,500.00");

  const state = await ctx.conversations.getWizardState(convId);
  assertEquals(state?.activeStepIdx, 2, "still on the duration question");
  assertEquals(state?.answers[1].optionId, "next_week");
  const quote = await ctx.quotes.getOwned(quoteId, "u-1");
  assertEquals(
    quote.terms?.find((t) => t.stepId === "start_date")?.value,
    "Next week",
  );
  assertEquals(quote.estimatedTotal, 1_950_000);
  // The changed pick comes back (same id) so the open thread shows it.
  const pick = res.newMessages.find((m) =>
    (m.payload as { wizardStepId?: string } | undefined)?.wizardStepId ===
      "start_date"
  );
  assertEquals(pick?.content, "Start: Next week");
  await resetKv();
});

Deno.test("REQ-585 M4 pair 7: 'the start should be next week … its 2 and a half weeks … what should I charge for the heated floor?' → the price answer also says the start date and the time to complete were NOT changed", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  const { convId } = await boundDraft(ctx, {
    summary: "Baño principal",
    description: "Quitar la tina\nRegadera de azulejo",
    lines: [["Baño principal", 1_800_000]],
  }, { terms: true, answered: [["start_date", "next_month"]] });
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: convId,
    content:
      "wait the start should be next week not next month, fix it. and its 2 and a half weeks not 2. also what should I charge for the heated floor normally?",
    step: { id: "wizard", wizardStepId: "wraps" },
  });
  const reply = textReplies(res.newMessages)[0].content;
  assertStringIncludes(
    reply,
    "I didn't change the start date or the time to complete",
  );
  const state = await ctx.conversations.getWizardState(convId);
  assertEquals(state?.answers[1].optionId, "next_month", "nothing invented");
  await resetKv();
});

Deno.test("REQ-585 M4: a terms-phase message naming a new start date that the model didn't apply says so", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  const { convId } = await boundDraft(ctx, {
    summary: "Baño principal",
    description: "Quitar la tina",
    lines: [["Baño principal", 1_800_000]],
  }, { terms: true, answered: [["start_date", "next_month"]] });
  answer(ctx.llm, { text: "Sounds good!" });
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: convId,
    content: "actually we start next week, not next month",
    step: { id: "wizard", wizardStepId: "wraps" },
  });
  const reply = textReplies(res.newMessages)[0].content;
  assertStringIncludes(reply, "Sounds good!");
  assertStringIncludes(reply, "I didn't change the start date");
  await resetKv();
});

// ---------------------------------------------------------------------------
// several changes + an answer
// ---------------------------------------------------------------------------

Deno.test("REQ-585 M4: several changes in one turn keep the model's answer after the outcome lines — minus its own claims of what changed", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  const { convId, quoteId } = await boundDraft(ctx, {
    summary: "Kitchen Renovation",
    description: "Demo existing kitchen\nInstall cabinets",
    descriptionByLang: { en: "Demo existing kitchen\nInstall cabinets" },
    lines: [["Kitchen Renovation", 2_000_000]],
  }, { terms: true });
  const details: LLMAction = {
    type: "update_job_details",
    payload: {
      descriptionByLang: {
        en: "Demo existing kitchen\nInstall cabinets\nPlumbing permit",
      },
    },
  };
  const permit: LLMAction = {
    type: "change_order",
    payload: { description: "Plumbing permit", deltaAmountCents: 45_000 },
  };
  answer(ctx.llm, {
    text:
      "Done! I've added the permit and updated the job details. The permit covers the plumbing rough-in only, not the fixtures.",
    action: details,
    actions: [details, permit],
  });
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: convId,
    content:
      "add a plumbing permit $450 to the details and the price — does the permit cover the fixtures too?",
    step: { id: "review" },
  });
  const reply = textReplies(res.newMessages)[0].content;
  assertStringIncludes(reply, "Updated the job details");
  assertStringIncludes(reply, "Plumbing permit ($450.00)");
  assert(
    reply.trimEnd().endsWith(
      "The permit covers the plumbing rough-in only, not the fixtures.",
    ),
    reply,
  );
  assert(!reply.includes("Done!"), reply);
  assertEquals(
    (await ctx.quotes.getOwned(quoteId, "u-1")).estimatedTotal,
    2_045_000,
  );
  await resetKv();
});
