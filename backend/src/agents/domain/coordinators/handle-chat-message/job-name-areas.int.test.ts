/**
 * REQ-1051 (LOOP-007 cycle 2, q2-35) — AMENDMENT of REQ-337: the job name the
 * customer reads keeps every area the assistant's card named.
 *
 * QA 2 (Spanish) drafted Q-002; the assistant card read "Pintura exterior y
 * reparación de cerca — Jorge Ramirez", but the SMS read "Tu Cotización +
 * Acuerdo para Pintura exterior (Q-002) está lista" — the fence dropped.
 * handle-chat-message threw away the model's over-budget jobName whole
 * (isValidJobName fails at 38 chars), and QuoteStore's fallback cut the
 * summary at 3 words ([Pintura, exterior, y] → "Pintura exterior").
 *
 * The stub LLM replays the create_quote; the coordinator, the stores and the
 * SMS coordinator are real (KV :memory:).
 */
import { assert, assertStringIncludes } from "#std/assert";
import { HandleChatMessage } from "./mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { StubLLMClient } from "@agents/domain/business/llm/implementations/stub/mod.ts";
import type { LLMResponse } from "@agents/domain/business/llm/base/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { FileStore } from "@files/domain/data/file-store/mod.ts";
import { BusinessAddressStore } from "@profile/domain/data/business-address-store/mod.ts";
import { SendPaperworkEmail } from "@paperwork/domain/coordinators/send-paperwork-email/mod.ts";
import { SendPaperworkSms } from "@paperwork/domain/coordinators/send-paperwork-sms/mod.ts";
import { EmailService } from "@communication/domain/data/email-service/mod.ts";
import { type SendSmsInput, SmsService } from "@users/domain/data/sms/mod.ts";
import { ShortLinkStore } from "@paperwork/domain/data/shortlink-store/mod.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { ConversationStore as CommConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore as CommMessageStore } from "@communication/domain/data/message-store/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";
import { ChangeOrderStore } from "@paperwork/domain/data/change-order-store/mod.ts";
import type { SendChangeOrderAlert } from "@paperwork/domain/coordinators/send-change-order-alert/mod.ts";
import { ApplyChatChangeOrder } from "@agents/domain/coordinators/apply-chat-change-order/mod.ts";
import { ReviseQuote } from "@agents/domain/coordinators/revise-quote/mod.ts";
import { isValidJobName } from "#quote-flow/job-name.ts";
import { TranslateQuote } from "@agents/domain/coordinators/translate-quote/mod.ts";
import { TranslateBullets } from "@agents/domain/coordinators/translate-bullets/mod.ts";
import type { LLMRequest } from "@agents/domain/business/llm/base/mod.ts";

async function seedSpanishContractor(
  userId: string,
  language: "en" | "es" = "es",
) {
  const kv = await getKv();
  const now = new Date().toISOString();
  await kv.set(["user", userId], {
    id: userId,
    phoneNumber: "+15125550235",
    name: "Ana Torres",
    email: "ana@test.dev",
    language,
    createdAt: now,
    updatedAt: now,
  });
  await new BusinessIdentityStore().upsert(userId, {
    businessName: "Torres Pintura",
    acceptedPaymentMethods: { check: { enabled: true } },
  });
  await new BusinessAddressStore().upsert(userId, {
    city: "Austin",
    state: "TX",
    postal: "78704",
  });
}

async function fresh(language: "en" | "es" = "es") {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  await seedSpanishContractor("u-1", language);
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
  const commsLog = () =>
    new LogPaperworkMessage(
      new CommConversationStore(),
      new CommMessageStore(),
    );
  const emailFlow = new SendPaperworkEmail(
    quotes,
    invoices,
    customers,
    users,
    identity,
    email,
    commsLog(),
  );
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
      commsLog(),
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
  const sms = new SmsService();
  const sent: SendSmsInput[] = [];
  sms.send = (input: SendSmsInput) => {
    sent.push(input);
    return Promise.resolve({ ok: true, sid: "SM-test" });
  };
  const smsFlow = new SendPaperworkSms(
    quotes,
    invoices,
    customers,
    users,
    identity,
    sms,
    new ShortLinkStore(),
    commsLog(),
  );
  return {
    conversations,
    llm,
    quotes,
    customers,
    users,
    flow,
    smsFlow,
    emailFlow,
    sent,
  };
}

const MESSAGE =
  "cotización para Jorge Ramirez: pintura exterior de la casa $4,200 y reparación de la cerca $1,800";
const SUMMARY = "Pintura exterior y reparación de cerca — Jorge Ramirez";
const LINES = [
  { description: "Pintura exterior de la casa", amountCents: 420_000 },
  { description: "Reparación de la cerca", amountCents: 180_000 },
];

/** Run the chat turn with the model's create_quote, then text the quote to
 *  the customer in Spanish. Returns the stored job name and the SMS body. */
async function draftAndText(jobName: string | undefined) {
  const ctx = await fresh();
  const answer: LLMResponse = {
    text: "Listo, preparé la cotización.",
    action: {
      type: "create_quote",
      payload: {
        summary: SUMMARY,
        ...(jobName ? { jobName } : {}),
        lineItems: LINES,
      },
    },
  };
  ctx.llm.setHandler(() => answer);
  const conv = await ctx.conversations.create({ userId: "u-1" });
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: MESSAGE,
  });
  const card = res.newMessages.find((m) => m.kind === "action_card");
  assert(card, "the turn drew a quote card");
  assertStringIncludes(card.content ?? "", "cerca", "the card names the fence");

  const [quote] = await ctx.quotes.listByUser("u-1");
  assert(quote, "the turn saved a draft quote");
  const customer = await ctx.customers.create("u-1", {
    name: "Jorge Ramirez",
    phoneNumber: "+15125551235",
  });
  await ctx.quotes.update(quote.id, "u-1", { customerId: customer.id });
  const r = await ctx.smsFlow.run("u-1", {
    kind: "quote",
    resourceId: quote.id,
    language: "es",
  });
  assert(r.ok, `the SMS went out: ${r.reason}`);
  const body = ctx.sent[0]?.body ?? "";
  await resetKv();
  return { jobName: quote.jobName ?? "", body };
}

Deno.test("REQ-1051 (LOOP-007 q2-35): the model's over-budget jobName 'Pintura exterior y reparación de cerca' is fitted to the budget, not dropped — the stored name and the SMS keep the fence", async () => {
  const { jobName, body } = await draftAndText(
    "Pintura exterior y reparación de cerca",
  );
  assert(isValidJobName(jobName), `jobName "${jobName}" is outside the budget`);
  assertStringIncludes(
    jobName.toLowerCase(),
    "cerca",
    `the stored jobName "${jobName}" dropped the fence`,
  );
  assertStringIncludes(
    body.toLowerCase(),
    "cerca",
    `the SMS dropped the fence: ${body}`,
  );
});

Deno.test("REQ-1051 (LOOP-007 q2-35): with no model jobName, the derived name for 'Pintura exterior y reparación de cerca — Jorge Ramirez' keeps the fence in the stored name and the SMS", async () => {
  const { jobName, body } = await draftAndText(undefined);
  assert(isValidJobName(jobName), `jobName "${jobName}" is outside the budget`);
  assertStringIncludes(
    jobName.toLowerCase(),
    "cerca",
    `the stored jobName "${jobName}" dropped the fence`,
  );
  assertStringIncludes(
    body.toLowerCase(),
    "cerca",
    `the SMS dropped the fence: ${body}`,
  );
});

/**
 * REQ-1092 (LOOP-007 cycle 3, q3-1 + q3-2) — AMENDMENT of REQ-1051.
 *
 * QA 3 typed the quote in English ("paint exterior of house $3,850 and stain
 * cedar fence $1,275.50"); the model's create_quote carried the summary
 * "Exterior painting and fence staining — Lupe Garza" and no jobName.
 * QuoteStore's English fallback named it "Exterior Painting Fence" (q3-2),
 * and TranslateQuote translated that name on its own into "Pintura exterior
 * de la cerca" — "exterior painting OF THE FENCE" — which titled the Spanish
 * customer's email, /q and signed copy (q3-1).
 *
 * The translator below replays what the model did with each text: the
 * observed rendering of the broken name verbatim, otherwise a faithful
 * word-for-word reading — so any name that keeps both areas translates to
 * one that keeps both.
 */
const ES_EXACT: Record<string, string> = {
  // QA 3, fleet-0: the model's Spanish for the stopword-stripped name.
  "Exterior Painting Fence": "Pintura exterior de la cerca",
  "Exterior painting and fence staining — Lupe Garza":
    "Pintura exterior y tinte para cerca — Lupe Garza",
  "Exterior painting and fence staining": "Pintura exterior y tinte para cerca",
  "Paint exterior of house": "Pintar el exterior de la casa",
  "Stain cedar fence": "Teñir la cerca de cedro",
};
const ES_WORDS: Record<string, string> = {
  exterior: "exterior",
  painting: "pintura",
  paint: "pintura",
  and: "y",
  "&": "y",
  fence: "cerca",
  staining: "tinte",
  stain: "tinte",
  house: "casa",
};

function scriptedTranslator() {
  const llm = new StubLLMClient();
  llm.setHandler((req: LLMRequest) => {
    const { texts } = JSON.parse(req.messages[0].content as string) as {
      texts: string[];
    };
    const toEs = /Spanish/.test(req.systemPrompt ?? "");
    return {
      text: JSON.stringify({
        texts: texts.map((t) =>
          !toEs ? t : ES_EXACT[t] ??
            t.split(/\s+/).map((w) => ES_WORDS[w.toLowerCase()] ?? w).join(
              " ",
            )
        ),
      }),
    };
  });
  return llm;
}

const EN_MESSAGE =
  "quote for Lupe Garza: paint exterior of house $3,850 and stain cedar fence $1,275.50";
const EN_SUMMARY = "Exterior painting and fence staining — Lupe Garza";
const EN_LINES = [
  { description: "Paint exterior of house", amountCents: 385_000 },
  { description: "Stain cedar fence", amountCents: 127_550 },
];

Deno.test("REQ-1092 (LOOP-007 q3-1, q3-2): an English create_quote 'Exterior painting and fence staining' with no model jobName — the stored name keeps 'and' and the fence, and the Spanish email subject and SMS name the house AND the fence, never 'de la cerca'", async () => {
  const ctx = await fresh("en");
  try {
    ctx.llm.setHandler(() => ({
      text: "Done, I drafted the quote.",
      action: {
        type: "create_quote",
        payload: { summary: EN_SUMMARY, lineItems: EN_LINES },
      },
    }));
    const conv = await ctx.conversations.create({ userId: "u-1" });
    await ctx.flow.run({
      userId: "u-1",
      conversationId: conv.id,
      content: EN_MESSAGE,
    });
    const [draft] = await ctx.quotes.listByUser("u-1");
    assert(draft, "the turn saved a draft quote");
    const customer = await ctx.customers.create("u-1", {
      name: "Lupe Garza",
      phoneNumber: "+15125551236",
      email: "lupe@test.dev",
    });
    await ctx.quotes.update(draft.id, "u-1", { customerId: customer.id });

    // q3-2: the English name the owner, /q heading and English subject read.
    const jobName = draft.jobName ?? "";
    assert(
      isValidJobName(jobName),
      `jobName "${jobName}" is outside the budget`,
    );
    assertStringIncludes(
      jobName,
      "Exterior Painting and Fence",
      `the stored jobName "${jobName}" dropped the joiner or the fence`,
    );

    // Send-time translation (SendQuote runs TranslateQuote before dispatch).
    await new TranslateQuote(
      ctx.quotes,
      new TranslateBullets(scriptedTranslator()),
      ctx.users,
    ).run({ userId: "u-1", quoteId: draft.id });

    const en = await ctx.emailFlow.run("u-1", {
      kind: "quote",
      resourceId: draft.id,
      language: "en",
    });
    assert(en.ok, `the English email went out: ${en.reason}`);
    assertStringIncludes(
      en.subject,
      "Exterior Painting and Fence",
      `the English subject: ${en.subject}`,
    );

    // q3-1: what the Spanish customer receives and signs.
    const es = await ctx.emailFlow.run("u-1", {
      kind: "quote",
      resourceId: draft.id,
      language: "es",
    });
    assert(es.ok, `the Spanish email went out: ${es.reason}`);
    const subject = es.subject.toLowerCase();
    assertStringIncludes(
      subject,
      "cerca",
      `the Spanish subject: ${es.subject}`,
    );
    assert(
      !subject.includes("de la cerca"),
      `the Spanish subject names the wrong scope ("exterior painting of the fence"): ${es.subject}`,
    );
    assert(
      / y (tinte (para |de )?)?cerca/.test(subject),
      `the Spanish subject does not join the house and the fence: ${es.subject}`,
    );

    const sms = await ctx.smsFlow.run("u-1", {
      kind: "quote",
      resourceId: draft.id,
      language: "es",
    });
    assert(sms.ok, `the SMS went out: ${sms.reason}`);
    const body = (ctx.sent.at(-1)?.body ?? "").toLowerCase();
    assert(
      !body.includes("de la cerca") &&
        / y (tinte (para |de )?)?cerca/.test(body),
      `the Spanish SMS names the wrong scope: ${body}`,
    );
  } finally {
    await resetKv();
  }
});
