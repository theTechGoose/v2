import { assert, assertEquals, assertRejects } from "#std/assert";
import { SendQuote } from "./mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { SendPaperworkEmail } from "@paperwork/domain/coordinators/send-paperwork-email/mod.ts";
import { SendPaperworkSms } from "@paperwork/domain/coordinators/send-paperwork-sms/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import { ShortLinkStore } from "@paperwork/domain/data/shortlink-store/mod.ts";
import {
  EmailService,
  type SendEmailInput,
} from "@communication/domain/data/email-service/mod.ts";
import { type DomainEvent, EventBus } from "@core/business/events/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { ConversationStore as CommConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore as CommMessageStore } from "@communication/domain/data/message-store/mod.ts";
import { TranslateQuote } from "@agents/domain/coordinators/translate-quote/mod.ts";
import { TranslateBullets } from "@agents/domain/coordinators/translate-bullets/mod.ts";
import { StubLLMClient } from "@agents/domain/business/llm/implementations/stub/mod.ts";
import { QuotePriceError } from "#quote-flow/quote-price-guard.ts";
import { notificationL10n } from "@communication/domain/coordinators/notify-on-event/mod.ts";

function fresh(translator?: TranslateQuote) {
  const conversations = new AgentConversationStore();
  const messages = new AgentMessageStore();
  const quotes = new QuoteStore();
  const invoices = new InvoiceStore();
  const customers = new CustomerStore();
  const bus = new EventBus();
  const email = new EmailService();
  const sentEmails: SendEmailInput[] = [];
  email.send = (input: SendEmailInput) => {
    sentEmails.push(input);
    return Promise.resolve({ ok: true, reason: "test_capture" });
  };
  const users = new UserStore();
  const identity = new BusinessIdentityStore();
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
  // SMS dispatch is best-effort; in dev (no TWILIO_* env) SmsService logs
  // instead of sending and never throws, so it doesn't affect these
  // email/status/bus assertions.
  const sms = new SmsService();
  const smser = new SendPaperworkSms(
    quotes,
    invoices,
    customers,
    users,
    identity,
    sms,
    new ShortLinkStore(),
    new LogPaperworkMessage(
      new CommConversationStore(),
      new CommMessageStore(),
    ),
  );
  const flow = new SendQuote(
    conversations,
    messages,
    quotes,
    bus,
    emailer,
    smser,
    users,
    translator,
    customers,
  );
  return {
    conversations,
    messages,
    quotes,
    customers,
    bus,
    sentEmails,
    flow,
    sms,
  };
}

/** The emailer refuses to send without a contractor name on file. UserStore
 *  create() assigns a random id, so write the user row (keyed ["user", id])
 *  directly. */
async function seedContractor(userId: string, language?: "en" | "es") {
  const kv = await getKv();
  const now = new Date().toISOString();
  await kv.set(["user", userId], {
    id: userId,
    phoneNumber: "+15125550000",
    name: "Test Contractor",
    email: "me@test.dev",
    ...(language ? { language } : {}),
    createdAt: now,
    updatedAt: now,
  });
}

async function makeReadyConversation(userId = "u-1") {
  const ctx = fresh();
  await seedContractor(userId);
  const customer = await ctx.customers.create(userId, {
    name: "Tom & Linda K.",
    email: "tom@example.com",
  });
  const quote = await ctx.quotes.create(userId, {
    summary: "Roof",
    lineItems: [],
    estimatedTotal: 12_500,
    status: "draft",
    customerId: customer.id,
  });
  const conv = await ctx.conversations.create({
    userId,
    quoteId: quote.id,
    customerId: customer.id,
  });
  return { ...ctx, conv, customer, quote };
}

Deno.test("send-quote: flips quote.status to 'sent' + stamps sentAt on first call", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = await makeReadyConversation();

  const r = await ctx.flow.run({
    userId: "u-1",
    conversationId: ctx.conv.id,
    quoteId: ctx.quote.id,
  });

  const reloaded = await ctx.quotes.getOwned(ctx.quote.id, "u-1");
  assertEquals(reloaded.status, "sent");
  assert(reloaded.sentAt, "sentAt should be stamped");
  assertEquals(r.conversation.id, ctx.conv.id);
  assertEquals(r.conversation.quoteStatus, "sent");
  assert(
    r.newMessages.length > 0,
    "should append at least one message confirming the send",
  );
  assertEquals(r.newMessages[0].kind, "phase_divider");
  assertEquals(
    (r.newMessages[0].payload as { quoteId?: string } | undefined)?.quoteId,
    ctx.quote.id,
  );
  await resetKv();
});

Deno.test("send-quote: dispatches paperwork email to the bound customer", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = await makeReadyConversation();

  await ctx.flow.run({
    userId: "u-1",
    conversationId: ctx.conv.id,
    quoteId: ctx.quote.id,
  });

  assertEquals(ctx.sentEmails.length, 1);
  assertEquals(ctx.sentEmails[0].to, "tom@example.com");
  // The Quote + Agreement email is quote-framed (review & accept flow), so
  // it references the job.
  assert(
    /Roof/i.test(ctx.sentEmails[0].subject),
    "email subject references the job",
  );
  await resetKv();
});

Deno.test("send-quote: emits 'quote:sent' DomainEvent on the bus", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = await makeReadyConversation();
  const seen: DomainEvent[] = [];
  ctx.bus.subscribe((e) => {
    seen.push(e);
  });

  await ctx.flow.run({
    userId: "u-1",
    conversationId: ctx.conv.id,
    quoteId: ctx.quote.id,
  });

  const ev = seen.find((e) => e.entityType === "quote" && e.action === "sent");
  assert(ev, "expected a quote:sent DomainEvent");
  assertEquals(ev!.entityId, ctx.quote.id);
  await resetKv();
});

Deno.test("REQ-476 (demo cycle 3, p8-pair9-a / p8-pair10-c): the quote:sent event names the customer and the job, so the feed reads 'Quote sent to <name>', not 'your client'", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = await makeReadyConversation();
  await ctx.quotes.update(ctx.quote.id, "u-1", { jobName: "Roof repair" });
  const seen: DomainEvent[] = [];
  ctx.bus.subscribe((e) => {
    seen.push(e);
  });

  await ctx.flow.run({
    userId: "u-1",
    conversationId: ctx.conv.id,
    quoteId: ctx.quote.id,
  });

  const ev = seen.find((e) => e.entityType === "quote" && e.action === "sent");
  assert(ev, "expected a quote:sent DomainEvent");
  assertEquals(ev!.data?.customerName, "Tom & Linda K.");
  assertEquals(ev!.data?.jobName, "Roof repair");
  // The notification feed (and the topbar ticker that reads it) fills
  // {name} from the event — no "your client" / "tu cliente" fallback.
  assertEquals(notificationL10n(ev!)?.titleParams, { name: "Tom & Linda K." });
  await resetKv();
});

Deno.test("send-quote: re-Send re-fires email but state-flip + bus emit stay idempotent", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = await makeReadyConversation();
  const events: DomainEvent[] = [];
  ctx.bus.subscribe((e) => {
    if (e.entityType === "quote" && e.action === "sent") events.push(e);
  });

  await ctx.flow.run({
    userId: "u-1",
    conversationId: ctx.conv.id,
    quoteId: ctx.quote.id,
  });
  assertEquals(ctx.sentEmails.length, 1);
  assertEquals(events.length, 1);

  // Second click: previous attempt may have failed delivery (e.g., Postmark
  // down on first try); the user clicks Send again expecting a retry.
  // Email re-fires; status flip + bus emit do NOT double — those are
  // one-time state changes.
  await ctx.flow.run({
    userId: "u-1",
    conversationId: ctx.conv.id,
    quoteId: ctx.quote.id,
  });
  assertEquals(ctx.sentEmails.length, 2, "email retries on every Send click");
  assertEquals(events.length, 1, "quote:sent bus event fires once");
  const reloaded = await ctx.quotes.getOwned(ctx.quote.id, "u-1");
  assertEquals(reloaded.status, "sent");
  await resetKv();
});

Deno.test("send-quote: forbidden across users", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = await makeReadyConversation();

  await assertRejects(
    () =>
      ctx.flow.run({
        userId: "u-OTHER",
        conversationId: ctx.conv.id,
        quoteId: ctx.quote.id,
      }),
    Error,
    "forbidden",
  );
  // Status untouched.
  const reloaded = await ctx.quotes.getOwned(ctx.quote.id, "u-1");
  assertEquals(reloaded.status, "draft");
  await resetKv();
});

Deno.test("send-quote: backfills quote.customerId from the conversation before dispatch (UX-02)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const ctx = fresh();
  await seedContractor("u-1");
  // Setup mirrors the real bug: customer is bound to conv via the wizard,
  // but the quote was locked BEFORE the customer existed — so quote.customerId
  // is missing and no recipient would resolve without the backfill.
  const customer = await ctx.customers.create("u-1", {
    name: "Late Customer",
    email: "late@example.com",
  });
  const quote = await ctx.quotes.create("u-1", {
    summary: "Roof",
    lineItems: [],
    estimatedTotal: 12_500,
    status: "draft",
    // intentionally NO customerId
  });
  const conv = await ctx.conversations.create({
    userId: "u-1",
    quoteId: quote.id,
    customerId: customer.id,
  });

  await ctx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    quoteId: quote.id,
  });

  // Quote.customerId must be backfilled from conv.customerId so the
  // emailer had a recipient to resolve.
  const reloadedQuote = await ctx.quotes.getOwned(quote.id, "u-1");
  assertEquals(reloadedQuote.customerId, customer.id);
  assertEquals(ctx.sentEmails.length, 1);
  assertEquals(ctx.sentEmails[0].to, "late@example.com");
  await resetKv();
});

Deno.test("send-quote: rejects a quote id that doesn't match conv.quoteId", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = await makeReadyConversation();
  // A second quote owned by the same user, but NOT bound to this conversation.
  const stray = await ctx.quotes.create("u-1", {
    summary: "Stray",
    lineItems: [],
    status: "draft",
    customerId: ctx.customer.id,
  });

  await assertRejects(
    () =>
      ctx.flow.run({
        userId: "u-1",
        conversationId: ctx.conv.id,
        quoteId: stray.id,
      }),
    Error,
  );
  const reloaded = await ctx.quotes.getOwned(stray.id, "u-1");
  assertEquals(reloaded.status, "draft");
  await resetKv();
});

// REQ-226 (demo: quote-invoice-money-m4, test-setup-claims-555-copy,
// customers-payments-fieldops-m1): the divider of a failed text carries a
// structured smsFailureCode the assistant branches on, and the reason the
// contractor reads names neither Twilio nor its error code.
async function sendSmsTo(phoneNumber: string | undefined) {
  const ctx = await makeReadyConversation();
  if (phoneNumber) {
    await ctx.customers.update(ctx.customer.id, "u-1", { phoneNumber });
  }
  const r = await ctx.flow.run({
    userId: "u-1",
    conversationId: ctx.conv.id,
    quoteId: ctx.quote.id,
    channel: "sms",
  });
  return {
    ctx,
    payload: (r.newMessages[0].payload ?? {}) as {
      textedTo?: string;
      smsFailureReason?: string;
      smsFailureCode?: string;
    },
    label: r.newMessages[0].content,
  };
}

Deno.test("REQ-226 send-quote: a fictional 555-01XX phone on file fails with smsFailureCode 'fictional' and no Twilio/21211 in the copy", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { payload, label } = await sendSmsTo("+15125550123");
  assertEquals(payload.textedTo, undefined);
  assertEquals(payload.smsFailureCode, "fictional");
  assert(payload.smsFailureReason, "a reason is recorded");
  assert(
    !/twilio|21211/i.test(payload.smsFailureReason!),
    `reason names no provider/code: ${payload.smsFailureReason}`,
  );
  assert(!/twilio|21211/i.test(label), `divider label: ${label}`);
  await resetKv();
});

Deno.test("REQ-226 send-quote: no phone on file fails with smsFailureCode 'missing'", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { payload } = await sendSmsTo(undefined);
  assertEquals(payload.smsFailureCode, "missing");
  await resetKv();
});

Deno.test("REQ-226 send-quote: Twilio's own 21211 rejection becomes smsFailureCode 'invalid' with plain copy", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx0 = await makeReadyConversation();
  ctx0.sms.send = () =>
    Promise.resolve({
      ok: false,
      reason: "sms.invalidNumber",
      code: 21211,
      detail: "Invalid 'To' Phone Number",
    });
  await ctx0.customers.update(ctx0.customer.id, "u-1", {
    phoneNumber: "+15126550123",
  });
  const r = await ctx0.flow.run({
    userId: "u-1",
    conversationId: ctx0.conv.id,
    quoteId: ctx0.quote.id,
    channel: "sms",
  });
  const payload = (r.newMessages[0].payload ?? {}) as {
    smsFailureReason?: string;
    smsFailureCode?: string;
  };
  assertEquals(payload.smsFailureCode, "invalid");
  assert(
    !/twilio|21211/i.test(payload.smsFailureReason ?? ""),
    `reason names no provider/code: ${payload.smsFailureReason}`,
  );
  await resetKv();
});

// ── REQ-236 (demo M8): a failed send is NOT a sent quote ──────────────────
// The delivery outcome is stored on the quote (`lastDelivery`), the quote
// only becomes "sent" (status, sentAt, `quote:sent`) when at least one
// channel actually delivered, and the conversation's list chip reads
// "undelivered" instead of "sent".

async function makeNoEmailConversation(userId = "u-1") {
  const ctx = fresh();
  await seedContractor(userId);
  // A customer with no email and no phone: every channel fails.
  const customer = await ctx.customers.create(userId, { name: "Maria Lopez" });
  const quote = await ctx.quotes.create(userId, {
    summary: "Fence",
    lineItems: [],
    estimatedTotal: 35_000,
    status: "draft",
    customerId: customer.id,
  });
  const conv = await ctx.conversations.create({
    userId,
    quoteId: quote.id,
    customerId: customer.id,
  });
  return { ...ctx, conv, customer, quote };
}

Deno.test("REQ-236: a send that delivers nowhere leaves the quote unsent and records the failure", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = await makeNoEmailConversation();
  const events: DomainEvent[] = [];
  ctx.bus.subscribe((e) => {
    if (e.entityType === "quote" && e.action === "sent") events.push(e);
  });

  const r = await ctx.flow.run({
    userId: "u-1",
    conversationId: ctx.conv.id,
    quoteId: ctx.quote.id,
    channel: "email",
  });

  const reloaded = await ctx.quotes.getOwned(ctx.quote.id, "u-1");
  assertEquals(reloaded.status, "draft", "a failed send is not a sent quote");
  assertEquals(reloaded.sentAt, undefined, "no sentAt without a delivery");
  assertEquals(reloaded.deliveredAt, undefined);
  assert(reloaded.lastDelivery, "the delivery outcome is stored on the quote");
  assertEquals(reloaded.lastDelivery!.channel, "email");
  assertEquals(reloaded.lastDelivery!.emailedTo, undefined);
  assert(reloaded.lastDelivery!.emailFailureReason, "failure reason kept");
  assertEquals(events.length, 0, "no quote:sent event for a failed send");
  assertEquals(r.conversation.quoteStatus, "undelivered");
  await resetKv();
});

Deno.test("REQ-236: a quote LockQuote already marked sent still reads undelivered after a failed send", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = await makeNoEmailConversation();
  const lockedAt = new Date().toISOString();
  await ctx.quotes.update(ctx.quote.id, "u-1", {
    status: "sent",
    sentAt: lockedAt,
  });

  const r = await ctx.flow.run({
    userId: "u-1",
    conversationId: ctx.conv.id,
    quoteId: ctx.quote.id,
    channel: "sms",
  });

  const reloaded = await ctx.quotes.getOwned(ctx.quote.id, "u-1");
  assertEquals(reloaded.deliveredAt, undefined);
  assertEquals(reloaded.lastDelivery?.channel, "sms");
  assertEquals(reloaded.lastDelivery?.textedTo, undefined);
  assert(reloaded.lastDelivery?.smsFailureReason, "sms failure reason kept");
  assertEquals(r.conversation.quoteStatus, "undelivered");
  await resetKv();
});

Deno.test("REQ-236: a good resend after a failure sends the quote and clears the failure", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = await makeNoEmailConversation();
  const events: DomainEvent[] = [];
  ctx.bus.subscribe((e) => {
    if (e.entityType === "quote" && e.action === "sent") events.push(e);
  });

  await ctx.flow.run({
    userId: "u-1",
    conversationId: ctx.conv.id,
    quoteId: ctx.quote.id,
    channel: "email",
  });
  // The contractor adds the email, then resends.
  await ctx.customers.update(ctx.customer.id, "u-1", {
    email: "maria@example.com",
  });
  const r = await ctx.flow.run({
    userId: "u-1",
    conversationId: ctx.conv.id,
    quoteId: ctx.quote.id,
    channel: "email",
  });

  const reloaded = await ctx.quotes.getOwned(ctx.quote.id, "u-1");
  assertEquals(reloaded.status, "sent");
  assert(reloaded.sentAt, "sentAt stamped on the first real delivery");
  assert(reloaded.deliveredAt, "deliveredAt stamped");
  assertEquals(reloaded.lastDelivery?.emailedTo, "maria@example.com");
  assertEquals(reloaded.lastDelivery?.emailFailureReason, undefined);
  assertEquals(events.length, 1, "quote:sent fires once, on the delivery");
  assertEquals(r.conversation.quoteStatus, "sent");
  await resetKv();
});

Deno.test("REQ-236: a successful send records where it went", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = await makeReadyConversation();

  await ctx.flow.run({
    userId: "u-1",
    conversationId: ctx.conv.id,
    quoteId: ctx.quote.id,
  });

  const reloaded = await ctx.quotes.getOwned(ctx.quote.id, "u-1");
  assert(reloaded.deliveredAt);
  assertEquals(reloaded.lastDelivery?.channel, "email");
  assertEquals(reloaded.lastDelivery?.emailedTo, "tom@example.com");
  assert(reloaded.lastDelivery?.at);
  await resetKv();
});

// REQ-264 (demo M15): a Spanish quote sent in English reads in English — the
// send fills every missing translation (description + line items) on the
// server before dispatch, instead of relying on the contractor having
// toggled the preview to that language.
Deno.test("REQ-264 (M15) send-quote translates a Spanish quote's line items before the English email goes out", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const llm = new StubLLMClient();
  llm.setHandler((req) => {
    const { texts } = JSON.parse(req.messages[0].content as string) as {
      texts: string[];
    };
    const toEn = /English/.test(req.systemPrompt ?? "");
    return {
      text: JSON.stringify({
        texts: texts.map((t) =>
          toEn && t === "Limpieza y retiro de desechos"
            ? "Cleanup and debris removal"
            : t
        ),
      }),
    };
  });
  const quotes = new QuoteStore();
  const ctx = fresh(
    new TranslateQuote(quotes, new TranslateBullets(llm), new UserStore()),
  );
  // REQ-333: a Spanish contractor typed the Spanish lines — Spanish is the
  // base, English the translation.
  await seedContractor("u-1", "es");
  const customer = await ctx.customers.create("u-1", {
    name: "Tom",
    email: "tom@example.com",
  });
  const quote = await ctx.quotes.create("u-1", {
    summary: "Pintar el baño",
    lineItems: [
      {
        description: "Limpieza y retiro de desechos",
        quantity: 1,
        unit: "ea",
        price: 5_000,
      },
      { description: "Pintar el baño", quantity: 1, unit: "ea", price: 40_000 },
    ],
    estimatedTotal: 45_000,
    status: "draft",
    customerId: customer.id,
  });
  const conv = await ctx.conversations.create({
    userId: "u-1",
    quoteId: quote.id,
    customerId: customer.id,
  });

  await ctx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    quoteId: quote.id,
    language: "en",
  });

  const after = await ctx.quotes.getOwned(quote.id, "u-1");
  assertEquals(
    after.lineItems[0].descriptionByLang?.en,
    "Cleanup and debris removal",
  );
  assertEquals(
    after.lineItems[0].descriptionByLang?.es,
    "Limpieza y retiro de desechos",
  );
  assertEquals(ctx.sentEmails.length, 1);
  const html = ctx.sentEmails[0].htmlBody ?? "";
  assert(
    html.includes("Cleanup and debris removal"),
    "the English email lists the translated line item",
  );
  assert(
    !html.includes("Limpieza y retiro de desechos"),
    "the English email does not fall back to the Spanish line item",
  );
  await resetKv();
});

Deno.test("REQ-264 (M15) a failing translator never blocks the send", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const llm = new StubLLMClient();
  llm.setHandler(() => {
    throw new Error("provider down");
  });
  const quotes = new QuoteStore();
  const translator = new TranslateQuote(quotes, new TranslateBullets(llm));
  const base = await makeReadyConversation();
  const ctx = fresh(translator);
  await ctx.quotes.update(base.quote.id, "u-1", {
    lineItems: [{ description: "Pintar", quantity: 1, unit: "ea", price: 1 }],
  });

  await ctx.flow.run({
    userId: "u-1",
    conversationId: base.conv.id,
    quoteId: base.quote.id,
  });

  const after = await ctx.quotes.getOwned(base.quote.id, "u-1");
  assertEquals(after.status, "sent");
  assertEquals(ctx.sentEmails.length, 1);
  await resetKv();
});

// REQ-248 (demo issue quote-invoice-money-m9): the first send is version 1's
// publication — it names who published it; a re-Send that publishes a
// pending edit says so in the divider, and the new version names its sender.
Deno.test("REQ-248 send-quote: the first send stamps version 1's publishedAt + publishedBy (the owner)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = await makeReadyConversation();
  await ctx.flow.run({
    userId: "u-1",
    conversationId: ctx.conv.id,
    quoteId: ctx.quote.id,
  });
  const q = await ctx.quotes.getOwned(ctx.quote.id, "u-1");
  assert(q.publishedAt, "publishedAt stamped at the first issue");
  assertEquals(q.publishedAt, q.sentAt);
  assertEquals(q.publishedBy, { userId: "u-1" });
});

Deno.test("REQ-248 send-quote: a re-Send that publishes a pending edit names Version 2 in the divider and files version 1 with its publisher", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = await makeReadyConversation();
  const first = await ctx.flow.run({
    userId: "u-1",
    conversationId: ctx.conv.id,
    quoteId: ctx.quote.id,
  });
  assert(
    !/Version/.test(first.newMessages[0].content),
    `the first send is not a revision: ${first.newMessages[0].content}`,
  );
  // the contractor edits the total after sending → a pending revision
  await ctx.quotes.setPending(ctx.quote.id, "u-1", { estimatedTotal: 15_000 });
  const again = await ctx.flow.run({
    userId: "u-1",
    conversationId: ctx.conv.id,
    quoteId: ctx.quote.id,
  });
  const divider = again.newMessages[0];
  assert(
    /Version 2/.test(divider.content),
    `the divider names the published revision: ${divider.content}`,
  );
  assertEquals(
    (divider.payload as { publishedVersion?: number }).publishedVersion,
    2,
  );
  const q = await ctx.quotes.getOwned(ctx.quote.id, "u-1");
  assertEquals(q.version, 2);
  assertEquals(q.publishedBy, { userId: "u-1", name: "Test Contractor" });
  const filed = await ctx.quotes.listVersions(ctx.quote.id, "u-1");
  assertEquals(filed.length, 1);
  assertEquals(filed[0].publishedBy, { userId: "u-1" });
  assertEquals(filed[0].publishedAt, filed[0].content.sentAt);
});

Deno.test("REQ-276 send-quote: the send note is ONE language — the contractor's UI language, even when the document goes out in English (demo i18n-formatting-m8)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  // A Spanish-UI contractor sends the quote in ENGLISH by text to a
  // fictional 555 number: the SMS reason comes back in Spanish (REQ-030),
  // and the note around it used to be the English template.
  await seedContractor("u-es", "es");
  const customer = await ctx.customers.create("u-es", {
    name: "Tom K.",
    phoneNumber: "+15555550123",
  });
  const quote = await ctx.quotes.create("u-es", {
    summary: "Roof",
    lineItems: [],
    estimatedTotal: 12_500,
    status: "draft",
    customerId: customer.id,
  });
  const conv = await ctx.conversations.create({
    userId: "u-es",
    quoteId: quote.id,
    customerId: customer.id,
  });

  const r = await ctx.flow.run({
    userId: "u-es",
    conversationId: conv.id,
    quoteId: quote.id,
    channel: "sms",
    language: "en",
  });

  const note = r.newMessages[0].content;
  // REQ-525: the label is the short Spanish line; the (Spanish) reason
  // rides on the payload for the send card, its one home.
  assertEquals(note, "Mensaje de texto no entregado", `divider in Spanish`);
  const reason = (r.newMessages[0].payload as { smsFailureReason?: string })
    .smsFailureReason ?? "";
  // REQ-523 (demo m16): the reason names the reserved block, not "every 555 number"
  assert(/número de prueba reservado/.test(reason), `Spanish reason: ${reason}`);
  assert(!/Quote \+ Agreement/.test(note), `no English template: ${note}`);
  await resetKv();
});

Deno.test("REQ-276 send-quote: a missing recipient reads in the contractor's language, not the dispatcher's English machine reason", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  await seedContractor("u-es2", "es");
  const customer = await ctx.customers.create("u-es2", { name: "Sin Correo" });
  const quote = await ctx.quotes.create("u-es2", {
    summary: "Roof",
    lineItems: [],
    estimatedTotal: 12_500,
    status: "draft",
    customerId: customer.id,
  });
  const conv = await ctx.conversations.create({
    userId: "u-es2",
    quoteId: quote.id,
    customerId: customer.id,
  });

  const r = await ctx.flow.run({
    userId: "u-es2",
    conversationId: conv.id,
    quoteId: quote.id,
    channel: "both",
  });

  const note = r.newMessages[0].content;
  assert(/^Cotización \+ Acuerdo no entregada/.test(note), `Spanish: ${note}`);
  assert(
    !/no recipient|pass `to`|attach a customer/.test(note),
    `no English reason: ${note}`,
  );
  assert(/sin destinatario/.test(note), `Spanish reason: ${note}`);
  await resetKv();
});

// REQ-302 (demo-loop cycle 1, B1): a quote with no price cannot be sent
// either — the demo sent the -$500 quote to the customer. Written straight to
// KV because the store now refuses such a quote.
Deno.test("REQ-302 B1 send-quote: refuses to send a quote with a negative line or a zero total — status stays draft, nothing is emailed", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  await seedContractor("u-1");
  const customer = await ctx.customers.create("u-1", {
    name: "Tom & Linda K.",
    email: "tom@example.com",
  });
  const kv = await getKv();
  const now = new Date().toISOString();
  for (
    const [id, price, total] of [
      ["q-neg", -50_000, -50_000],
      ["q-zero", 0, 0],
    ] as const
  ) {
    await kv.set(["quote", id], {
      id,
      userId: "u-1",
      summary: "Panel swap",
      lineItems: [{
        description: "Panel swap",
        quantity: 1,
        unit: "ea",
        price,
      }],
      estimatedTotal: total,
      status: "draft",
      customerId: customer.id,
      createdAt: now,
      updatedAt: now,
    });
    await kv.set(["quote_by_user", "u-1", id], id);
    const conv = await ctx.conversations.create({
      userId: "u-1",
      quoteId: id,
      customerId: customer.id,
    });
    await assertRejects(
      () =>
        ctx.flow.run({ userId: "u-1", conversationId: conv.id, quoteId: id }),
      QuotePriceError,
    );
    const after = await ctx.quotes.getOwned(id, "u-1");
    assertEquals(after.status, "draft");
    assertEquals(after.sentAt, undefined);
  }
  assertEquals(ctx.sentEmails.length, 0);
  await resetKv();
});

// REQ-399 (demo-loop cycle 2, M16): a double-click on Send POSTed /send-quote
// twice and the customer got two emails. The client now tags one Send with a
// requestId; a repeat of that id within the window delivers nothing again.
Deno.test("REQ-399 M16 send-quote: the same requestId twice (even concurrently) delivers once", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = await makeReadyConversation();
  const input = {
    userId: "u-1",
    conversationId: ctx.conv.id,
    quoteId: ctx.quote.id,
    requestId: "req-abc-1",
  };
  const [a, b] = await Promise.all([ctx.flow.run(input), ctx.flow.run(input)]);
  assertEquals(ctx.sentEmails.length, 1, "one Send, one email");
  const dividers = (await ctx.messages.listByConversation(ctx.conv.id))
    .filter((m) => m.kind === "phase_divider");
  assertEquals(dividers.length, 1, "one 'emailed to' card");
  assertEquals(
    a.newMessages.length + b.newMessages.length,
    1,
    "only the first answer carries the divider",
  );
  // A later run with the same id is still the same Send.
  await ctx.flow.run(input);
  assertEquals(ctx.sentEmails.length, 1);
  await resetKv();
});

Deno.test("REQ-399 M16 send-quote: a new requestId is a new Send (a deliberate re-send still delivers)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = await makeReadyConversation();
  const base = {
    userId: "u-1",
    conversationId: ctx.conv.id,
    quoteId: ctx.quote.id,
  };
  await ctx.flow.run({ ...base, requestId: "req-1" });
  await ctx.flow.run({ ...base, requestId: "req-2" });
  assertEquals(ctx.sentEmails.length, 2);
  await resetKv();
});

Deno.test("REQ-399 M16 send-quote: a Send that threw does not hold its requestId", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = await makeReadyConversation();
  const input = {
    userId: "u-1",
    conversationId: ctx.conv.id,
    quoteId: "not-this-conversations-quote",
    requestId: "req-throws",
  };
  await assertRejects(() => ctx.flow.run(input));
  // The same id with the right quote now goes through.
  await ctx.flow.run({ ...input, quoteId: ctx.quote.id });
  assertEquals(ctx.sentEmails.length, 1);
  await resetKv();
});

// ── REQ-525 (demo-loop cycle 3, p8-pair2-a): one failure, one reason ──────
// A text to a 555 number used to explain itself three times: the divider
// ("Quote + Agreement text failed — <reason>"), the send card ("Couldn't
// send — Not delivered — <reason>") and the recovery box. The reason now
// lives only on the send card (read from the divider's payload); the
// divider's own label is the short "Text not delivered".
Deno.test("REQ-525 send-quote: a failed text's divider label is short and does not restate the reason; the payload still carries it", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { payload, label } = await sendSmsTo("+15125550123");
  assert(payload.smsFailureReason, "the reason stays on the payload");
  assertEquals(label, "Text not delivered");
  assert(
    !label.includes(payload.smsFailureReason!),
    `divider restates the reason: ${label}`,
  );
  await resetKv();
});

// REQ-589 (demo-loop cycle 4, m15): pair 7 sent while in English and switched
// to Spanish — the divider still read "Text not delivered" over "that's a
// reserved test number…". The label and the reason were baked in the UI
// language at send time; now they carry their keys.
Deno.test("REQ-589 m15 send-quote: the send divider's label and SMS reason re-render in the other language", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { ctx: _ctx, payload, label } = await sendSmsTo("+15125550123");
  assertEquals(label, "Text not delivered");
  const { localizeChatMessage } = await import("#quote-flow/chat-i18n.ts");
  const { t } = await import("@core/i18n/mod.ts");
  const es = localizeChatMessage(
    { content: label, payload },
    "es",
    (l: "en" | "es", k: string, v?: Record<string, string | number>) =>
      t(l, k, v),
  );
  const p = es.payload as { label?: string; smsFailureReason?: string };
  assertEquals(es.content, t("es", "sendQuote.divider.textNotDelivered"));
  assertEquals(p.label, t("es", "sendQuote.divider.textNotDelivered"));
  assertEquals(p.smsFailureReason, t("es", "sms.fictionalNumber"));
  await resetKv();
});

Deno.test("REQ-589 m15 send-quote: a missing recipient inside a 'both' note re-renders whole", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  await seedContractor("u-es3", "es");
  const customer = await ctx.customers.create("u-es3", { name: "Sin Correo" });
  const quote = await ctx.quotes.create("u-es3", {
    summary: "Roof",
    lineItems: [],
    estimatedTotal: 12_500,
    status: "draft",
    customerId: customer.id,
  });
  const conv = await ctx.conversations.create({
    userId: "u-es3",
    quoteId: quote.id,
    customerId: customer.id,
  });
  const r = await ctx.flow.run({
    userId: "u-es3",
    conversationId: conv.id,
    quoteId: quote.id,
    channel: "both",
  });
  const { localizeChatMessage } = await import("#quote-flow/chat-i18n.ts");
  const { t } = await import("@core/i18n/mod.ts");
  const en = localizeChatMessage(
    r.newMessages[0],
    "en",
    (l: "en" | "es", k: string, v?: Record<string, string | number>) =>
      t(l, k, v),
  );
  const noRecipient = t("en", "sendQuote.divider.noRecipient");
  assertEquals(
    en.content,
    t("en", "sendQuote.divider.notDelivered", {
      emailReason: noRecipient,
      smsReason: noRecipient,
    }),
  );
  await resetKv();
});

// REQ-586 (demo-loop cycle 4, M11): the customer link the owner opens or
// copies in the app ("Open as customer", "Copy") must open in the language
// the quote went out in. The send records that language on the quote
// (lastDelivery.lang) and on the send divider (payload.lang) — including a
// send that reached nobody, whose link is exactly the fallback.
Deno.test("REQ-586 (cycle 4, M11) send-quote: the language a quote is sent in is stored on lastDelivery and on the divider payload", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = await makeReadyConversation();
  const r = await ctx.flow.run({
    userId: "u-1",
    conversationId: ctx.conv.id,
    quoteId: ctx.quote.id,
    channel: "email",
    language: "es",
  });
  const reloaded = await ctx.quotes.getOwned(ctx.quote.id, "u-1");
  assertEquals(reloaded.lastDelivery?.lang, "es");
  const payload = r.newMessages[0].payload as { lang?: string };
  assertEquals(payload.lang, "es");
  await resetKv();
});

Deno.test("REQ-586 (cycle 4, M11) send-quote: with no per-send pick, the stored send language (Settings) is the one recorded", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = await makeReadyConversation();
  await new BusinessIdentityStore().upsert("u-1", { commsLanguage: "es" });
  const r = await ctx.flow.run({
    userId: "u-1",
    conversationId: ctx.conv.id,
    quoteId: ctx.quote.id,
    channel: "email",
  });
  const reloaded = await ctx.quotes.getOwned(ctx.quote.id, "u-1");
  assertEquals(reloaded.lastDelivery?.lang, "es");
  assertEquals((r.newMessages[0].payload as { lang?: string }).lang, "es");
  await resetKv();
});

Deno.test("REQ-586 (cycle 4, M11) send-quote: a text that reached nobody still records its language (the link is the fallback)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = await makeNoEmailConversation();
  const r = await ctx.flow.run({
    userId: "u-1",
    conversationId: ctx.conv.id,
    quoteId: ctx.quote.id,
    channel: "sms",
    language: "es",
  });
  const reloaded = await ctx.quotes.getOwned(ctx.quote.id, "u-1");
  assertEquals(reloaded.deliveredAt, undefined);
  assertEquals(reloaded.lastDelivery?.lang, "es");
  assertEquals((r.newMessages[0].payload as { lang?: string }).lang, "es");
  await resetKv();
});

// REQ-682 (demo-loop cycle 5, m28): the sent quote email promises a text
// only when this Send texts the customer — pair 1 sent email-only and the
// email still said "Pick a start day — We'll text to confirm".
Deno.test("REQ-682 (m28) send-quote: the email's start-day step mentions a text only on a send that texts", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  await seedContractor("u-1");
  const customer = await ctx.customers.create("u-1", {
    name: "Tom K.",
    email: "tom@example.com",
    phoneNumber: "+15125551234",
  });
  const mk = async () => {
    const quote = await ctx.quotes.create("u-1", {
      summary: "Roof",
      lineItems: [],
      estimatedTotal: 12_500,
      status: "draft",
      customerId: customer.id,
    });
    const conv = await ctx.conversations.create({
      userId: "u-1",
      quoteId: quote.id,
      customerId: customer.id,
    });
    return { quote, conv };
  };
  const a = await mk();
  await ctx.flow.run({
    userId: "u-1",
    conversationId: a.conv.id,
    quoteId: a.quote.id,
    channel: "email",
  });
  const emailOnly = ctx.sentEmails.at(-1)?.htmlBody ?? "";
  assert(/We(?:&#39;|')ll confirm a start day/.test(emailOnly), "no start yet");
  assert(
    !/Pick a start day|We(?:&#39;|')ll text/.test(emailOnly),
    "an email-only send promises no text",
  );

  const b = await mk();
  await ctx.flow.run({
    userId: "u-1",
    conversationId: b.conv.id,
    quoteId: b.quote.id,
    channel: "both",
  });
  const texted = ctx.sentEmails.at(-1)?.htmlBody ?? "";
  assert(/We(?:&#39;|')ll text you/.test(texted), "a texted send says so");
  await resetKv();
});

// REQ-764 (demo-loop cycle 5v2, issue m12 — re-test of REQ-681): the
// verifier's exact case. Maria's cell is (512) 555-0144, a reserved test
// number the send dialog already says can't take texts; the contractor still
// picks "Text + Email". The quote dispatcher must not try to text it: no SMS
// dispatch at all, and the divider reads "emailed to … — not texted: <reason>",
// never "text failed (…)". In en and es.
async function sendBothToReservedNumber(lang?: "es") {
  const userId = lang ? "u-764es" : "u-764";
  const ctx = fresh();
  await seedContractor(userId, lang);
  let smsSends = 0;
  ctx.sms.send = (() => {
    smsSends++;
    return Promise.resolve({ ok: true, to: "+15125550144" });
  }) as typeof ctx.sms.send;
  const customer = await ctx.customers.create(userId, {
    name: "Maria Lopez",
    email: "maria@example.com",
    phoneNumber: "(512) 555-0144",
  });
  const quote = await ctx.quotes.create(userId, {
    summary: "Bathroom remodel",
    lineItems: [],
    estimatedTotal: 8_400,
    status: "draft",
    customerId: customer.id,
  });
  const conv = await ctx.conversations.create({
    userId,
    quoteId: quote.id,
    customerId: customer.id,
  });
  // The paperwork SMS dispatcher itself is never asked to text it.
  const smser = (ctx.flow as unknown as { smser: SendPaperworkSms }).smser;
  const realRun = smser.run.bind(smser);
  smser.run = ((...a: Parameters<typeof realRun>) => {
    smsSends++;
    return realRun(...a);
  }) as typeof smser.run;
  const r = await ctx.flow.run({
    userId,
    conversationId: conv.id,
    quoteId: quote.id,
    channel: "both",
  });
  return { ctx, r, smsSends: () => smsSends, label: r.newMessages[0].content };
}

Deno.test("REQ-764 m12 (cycle 5v2) send-quote: 'Text + Email' to a 555-01XX cell emails, never dispatches the text, and says 'not texted: <reason>'", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { t } = await import("@core/i18n/mod.ts");
  const { r, smsSends, label, ctx } = await sendBothToReservedNumber();
  assertEquals(ctx.sentEmails.length, 1, "the email still goes out");
  assertEquals(smsSends(), 0, "no text is attempted to a reserved number");
  assert(!/text failed/i.test(label), `never 'text failed': ${label}`);
  assertEquals(
    label,
    "Quote + Agreement emailed to maria@example.com — not texted: " +
      t("en", "sms.fictionalNumber"),
  );
  const p = (r.newMessages[0].payload ?? {}) as Record<string, unknown>;
  assertEquals(p.smsSkipped, true);
  assertEquals(p.textedTo, undefined);
  // The REQ-226 recovery form ("check the number") still has its code.
  assertEquals(p.smsFailureCode, "fictional");
  await resetKv();
});

Deno.test("REQ-764 m12 (cycle 5v2) send-quote: the Spanish divider says 'no se envió por texto: <motivo>', and re-renders in English", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { t } = await import("@core/i18n/mod.ts");
  const { r, smsSends, label } = await sendBothToReservedNumber("es");
  assertEquals(smsSends(), 0);
  assertEquals(
    label,
    t("es", "sendQuote.divider.emailedNotTexted", {
      emailedTo: "maria@example.com",
      reason: t("es", "sms.fictionalNumber"),
    }),
  );
  assert(label.includes(t("es", "sms.fictionalNumber")), label);
  const { localizeChatMessage } = await import("#quote-flow/chat-i18n.ts");
  const en = localizeChatMessage(
    r.newMessages[0],
    "en",
    (l: "en" | "es", k: string, v?: Record<string, string | number>) =>
      t(l, k, v),
  );
  assertEquals(
    en.content,
    "Quote + Agreement emailed to maria@example.com — not texted: " +
      t("en", "sms.fictionalNumber"),
  );
  await resetKv();
});
