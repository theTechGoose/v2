/**
 * REQ-583 (demo-loop cycle 4, run r857a9d67, M2) — the assistant sends the
 * invoice and records the payment it is told about, on the real stores.
 *
 *   pair 1: "Linda paid the deposit $1,425 by Zelle today. Send her the
 *           invoice" → an invoice summary; the Zelle payment was ignored.
 *   pair 3: "Invoice Maria for the deep clean" → "…INV-001 hasn't gone out
 *           yet — it's scheduled for Nov 19" (nothing to press), then "send it
 *           to her now please" → "I can't send the invoice directly…".
 *   pair 6: "Job done for Carmen Ruiz, faucet and the 2 doors. Make the
 *           invoice for $450 please." (new chat) → 'I couldn't find a line
 *           called "invoice for" on Q-001…'.
 *   pair 7: "she paid the deposit by check" → "You can check the payment
 *           status in the Invoices section.".
 *   pair 9: "Mándala ahora por favor, ya terminé hoy" → "No puedo enviar la
 *           factura ahora, ya que está programada…".
 *
 * The stub model is scripted to answer as the demo's model did whenever it is
 * reached, so a turn that still reaches it fails with the demo's words.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { HandleChatMessage } from "./mod.ts";
import { ChatBilling } from "@agents/domain/coordinators/chat-billing/mod.ts";
import { SendInvoice } from "@agents/domain/coordinators/send-invoice/mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { StubLLMClient } from "@agents/domain/business/llm/implementations/stub/mod.ts";
import type {
  LLMRequest,
  LLMResponse,
} from "@agents/domain/business/llm/base/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { PaymentStore } from "@paperwork/domain/data/payment-store/mod.ts";
import { ChangeOrderStore } from "@paperwork/domain/data/change-order-store/mod.ts";
import { ShortLinkStore } from "@paperwork/domain/data/shortlink-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { type SendSmsInput, SmsService } from "@users/domain/data/sms/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { BusinessAddressStore } from "@profile/domain/data/business-address-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { FileStore } from "@files/domain/data/file-store/mod.ts";
import { SendPaperworkEmail } from "@paperwork/domain/coordinators/send-paperwork-email/mod.ts";
import { SendPaperworkSms } from "@paperwork/domain/coordinators/send-paperwork-sms/mod.ts";
import { ConfirmPayment } from "@paperwork/domain/coordinators/confirm-payment/mod.ts";
import { RecordPaymentFromUtterance } from "@paperwork/domain/coordinators/record-payment-from-utterance/mod.ts";
import { RenderReceiptPdf } from "@paperwork/domain/coordinators/render-receipt-pdf/mod.ts";
import { MarkInvoicePaid } from "@paperwork/domain/coordinators/mark-invoice-paid/mod.ts";
import { ComputeInvoiceBalance } from "@paperwork/domain/coordinators/compute-invoice-balance/mod.ts";
import type { SendChangeOrderAlert } from "@paperwork/domain/coordinators/send-change-order-alert/mod.ts";
import {
  EmailService,
  type SendEmailInput,
} from "@communication/domain/data/email-service/mod.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { ConversationStore as CommConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore as CommMessageStore } from "@communication/domain/data/message-store/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";
import { ApplyChatChangeOrder } from "@agents/domain/coordinators/apply-chat-change-order/mod.ts";
import { ReviseQuote } from "@agents/domain/coordinators/revise-quote/mod.ts";
import { wizardSpecFor } from "@agents/domain/business/terms-wizard-spec/mod.ts";
import type { AgentMessage } from "@agents/dto/message.ts";

const U = "u-583";

async function seedOnboarded(language: "en" | "es" = "en") {
  const kv = await getKv();
  const now = new Date().toISOString();
  await kv.set(["user", U], {
    id: U,
    phoneNumber: "+15127770000",
    name: language === "es" ? "Rosa Delgado" : "Maria Castro",
    email: "pro@test.dev",
    language,
    createdAt: now,
    updatedAt: now,
  });
  await new BusinessIdentityStore().upsert(U, {
    businessName: "Castro Painting",
    acceptedPaymentMethods: {
      zelle: { enabled: true, handle: "pro@test.dev" },
    },
  });
  await new BusinessAddressStore().upsert(U, {
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
  const payments = new PaymentStore();
  const customers = new CustomerStore();
  const users = new UserStore();
  const identity = new BusinessIdentityStore();
  const bus = new EventBus();
  const emails: SendEmailInput[] = [];
  const email = new EmailService();
  email.send = (input: SendEmailInput) => {
    emails.push(input);
    return Promise.resolve({ ok: true, reason: "test_capture" });
  };
  const texts: SendSmsInput[] = [];
  const sms = new SmsService();
  sms.send = (input: SendSmsInput) => {
    texts.push(input);
    return Promise.resolve({ ok: true, sid: `SM${texts.length}` });
  };
  const commsLog = new LogPaperworkMessage(
    new CommConversationStore(),
    new CommMessageStore(),
  );
  const emailer = new SendPaperworkEmail(
    quotes,
    invoices,
    customers,
    users,
    identity,
    email,
    commsLog,
  );
  const texter = new SendPaperworkSms(
    quotes,
    invoices,
    customers,
    users,
    identity,
    sms,
    new ShortLinkStore(),
    commsLog,
  );
  const receiptPdf = new RenderReceiptPdf();
  receiptPdf.run = () => Promise.resolve(new Uint8Array([37, 80, 68, 70]));
  const markPaid = new MarkInvoicePaid({} as SendPaperworkEmail, invoices); // REQ-556: + InvoiceStore
  markPaid.run = () => Promise.resolve();
  const confirm = new ConfirmPayment(
    invoices,
    payments,
    customers,
    users,
    identity,
    email,
    sms,
    new ShortLinkStore(),
    receiptPdf,
    commsLog,
    bus,
    markPaid,
    new ComputeInvoiceBalance(invoices, payments, markPaid),
  );
  const billing = new ChatBilling(
    conversations,
    messages,
    quotes,
    invoices,
    customers,
    emailer,
    texter,
    new RecordPaymentFromUtterance(invoices, customers, confirm),
    new SendInvoice(conversations, messages, quotes, invoices, bus, emailer),
  );
  const changeOrders = new ChangeOrderStore();
  const flow = new HandleChatMessage(
    conversations,
    messages,
    quotes,
    new FileStore(),
    users,
    identity,
    new BusinessAddressStore(),
    bus,
    emailer,
    llm,
    new ApplyChatChangeOrder(
      quotes,
      invoices,
      changeOrders,
      customers,
      {
        run: () => Promise.resolve({ ok: true }),
      } as unknown as SendChangeOrderAlert,
    ),
    new ReviseQuote(quotes, customers),
    undefined,
    customers,
    undefined,
    billing,
  );
  return {
    conversations,
    messages,
    llm,
    quotes,
    invoices,
    payments,
    customers,
    changeOrders,
    emails,
    texts,
    flow,
  };
}
type Fx = ReturnType<typeof fresh>;

/** Every chat-model call is recorded and answered as `answer` says — by
 *  default with the demo's dead end. */
function scriptLlm(
  fx: Fx,
  answer: (req: LLMRequest) => LLMResponse = () => ({
    text:
      "I can't send the invoice directly. You can check the Invoices section to see the scheduled invoice.",
  }),
) {
  const chat: LLMRequest[] = [];
  fx.llm.setHandler((req) => {
    chat.push(req);
    return answer(req);
  });
  return chat;
}

const textOf = (msgs: AgentMessage[]) =>
  msgs.filter((m) => m.role === "assistant" && m.kind === "text")
    .map((m) => m.content).join("\n");
const cardsOf = (msgs: AgentMessage[]) =>
  msgs.filter((m) => m.kind === "action_card").map((m) =>
    m.payload as Record<string, unknown>
  );

async function withKv(fn: () => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  try {
    await fn();
  } finally {
    await resetKv();
  }
}

/** A signed quote and its invoices, the conversation bound to it (terms
 *  phase, the wizard done) — what signing on the public page leaves. */
async function signedJob(
  fx: Fx,
  opts: {
    customer: { name: string; email?: string; phoneNumber?: string };
    job: string;
    totalCents: number;
    invoices: Record<string, unknown>[];
  },
) {
  const customer = await fx.customers.create(U, opts.customer);
  const quote = await fx.quotes.create(U, {
    customerId: customer.id,
    summary: opts.job,
    jobName: opts.job,
    lineItems: [{
      description: opts.job,
      quantity: 1,
      unit: "ea",
      price: opts.totalCents,
    }],
    estimatedTotal: opts.totalCents,
    status: "draft",
  });
  await fx.quotes.update(quote.id, U, {
    status: "accepted",
    lockedAt: "2026-11-12T15:00:00Z",
    sentAt: "2026-11-12T15:02:00Z",
    acceptedAt: "2026-11-12T15:07:18Z",
    acceptedName: opts.customer.name,
  });
  const invoices = [];
  for (const inv of opts.invoices) {
    invoices.push(
      await fx.invoices.create(
        U,
        {
          quoteId: quote.id,
          customerId: customer.id,
          issuedDate: "2026-11-12",
          ...inv,
        } as Parameters<InvoiceStore["create"]>[1],
      ),
    );
  }
  const conv = await fx.conversations.create({
    userId: U,
    quoteId: quote.id,
    customerId: customer.id,
    currentPhase: "terms",
  });
  const spec = wizardSpecFor("quote");
  await fx.conversations.putWizardState(conv.id, {
    specId: spec.id,
    activeStepIdx: spec.steps.length,
    answers: [],
  });
  return { customer, quote, invoices, conv };
}

/** Pair 1: Linda Perez, $2,850 repaint, 50/50 — INV-001 $1,425 deposit went
 *  out at signing, INV-002 $1,425 scheduled for Nov 22. */
const lindaJob = (fx: Fx) =>
  signedJob(fx, {
    customer: {
      name: "Linda Perez",
      email: "linda@example.com",
      phoneNumber: "+15127770101",
    },
    job: "Interior Painting 3 Bedrooms",
    totalCents: 285_000,
    invoices: [
      {
        amount: 142_500,
        status: "sent",
        sentAt: "2026-11-12T15:07:19Z",
        dueDate: "2026-11-19",
        installmentIndex: 1,
        installmentTotal: 2,
      },
      {
        amount: 142_500,
        status: "scheduled",
        scheduledFor: "2026-11-22",
        dueDate: "2026-12-07",
        installmentIndex: 2,
        installmentTotal: 2,
      },
    ],
  });

/** Pair 3: Maria Lopez, $320 deep clean, payment upon completion — INV-001
 *  scheduled for Nov 19 (due Dec 19), nothing sent at signing. */
const mariaJob = (
  fx: Fx,
  customer: { name: string; email?: string; phoneNumber?: string } = {
    name: "Maria Lopez",
    email: "maria@example.com",
  },
) =>
  signedJob(fx, {
    customer,
    job: "3-bedroom 2-bath Cleaning",
    totalCents: 32_000,
    invoices: [{
      amount: 32_000,
      status: "scheduled",
      scheduledFor: "2026-11-19",
      dueDate: "2026-12-19",
      installmentIndex: 1,
      installmentTotal: 1,
    }],
  });

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

Deno.test("REQ-583 M2: pair 1 — 'Linda paid the deposit $1,425 by Zelle today. Send her the invoice' records the $1,425 Zelle payment on INV-001 and shows INV-002 with Send now", async () => {
  await withKv(async () => {
    const fx = fresh();
    await seedOnboarded();
    const { conv, invoices: [deposit, balance] } = await lindaJob(fx);
    const chat = scriptLlm(fx, () => ({
      text:
        "Linda Perez signed, so the $1,425 deposit invoice (INV-001) went out automatically — due Nov 19.",
    }));

    const res = await fx.flow.run({
      userId: U,
      conversationId: conv.id,
      content:
        "Linda paid the deposit $1,425 by Zelle today. Send her the invoice",
    });

    const said = textOf(res.newMessages);
    assertEquals(chat.length, 0, `the chat model answered: ${said}`);
    const paid = await fx.invoices.getOwned(deposit.id, U);
    assertEquals(paid.status, "paid", `INV-001 was not recorded — ${said}`);
    const rows = await fx.payments.listByInvoice(deposit.id, U);
    assertEquals(rows.map((p) => [p.amount, p.method]), [[142_500, "zelle"]]);
    assertStringIncludes(said, "$1,425");
    assertStringIncludes(said, "Zelle");
    assertStringIncludes(said, deposit.number!);
    assertStringIncludes(said, "Linda Perez");
    // the balance: when it goes out, and a Send-now card — never sent by itself
    assertStringIncludes(said, balance.number!);
    const card = cardsOf(res.newMessages).find((p) =>
      p.invoiceId === balance.id
    );
    assertEquals(card?.actionType, "invoice");
    assertEquals(card?.status, "scheduled");
    assertEquals(card?.offerSend, true);
    assertEquals(
      (await fx.invoices.getOwned(balance.id, U)).status,
      "scheduled",
    );
    assertEquals((await fx.invoices.listByUser(U)).length, 2);
  });
});

Deno.test("REQ-583 M2: pair 7 — 'she paid the deposit by check' records the $19,000 check on the deposit invoice", async () => {
  await withKv(async () => {
    const fx = fresh();
    await seedOnboarded();
    const { conv, invoices: [deposit] } = await signedJob(fx, {
      customer: { name: "Carol Henderson", phoneNumber: "+15127770106" },
      job: "Henderson Kitchen Gut",
      totalCents: 3_800_000,
      invoices: [
        {
          amount: 1_900_000,
          status: "sent",
          dueDate: "2026-11-19",
          installmentIndex: 1,
          installmentTotal: 2,
        },
        {
          amount: 1_900_000,
          status: "scheduled",
          scheduledFor: "2026-12-14",
          installmentIndex: 2,
          installmentTotal: 2,
        },
      ],
    });
    const chat = scriptLlm(fx, () => ({
      text: "You can check the payment status in the Invoices section.",
    }));

    const res = await fx.flow.run({
      userId: U,
      conversationId: conv.id,
      content: "she paid the deposit by check",
    });

    const said = textOf(res.newMessages);
    assertEquals(chat.length, 0, `the chat model answered: ${said}`);
    assertEquals((await fx.invoices.getOwned(deposit.id, U)).status, "paid");
    const rows = await fx.payments.listByInvoice(deposit.id, U);
    assertEquals(rows.map((p) => [p.amount, p.method]), [[1_900_000, "check"]]);
    assertStringIncludes(said, "$19,000");
    assertStringIncludes(said, "check");
    assert(!/Invoices section/i.test(said), said);
  });
});

Deno.test("REQ-583 M2: a part payment leaves the rest owed; two open invoices and no clue which → asks, records nothing", async () => {
  await withKv(async () => {
    const fx = fresh();
    await seedOnboarded();
    const { conv, invoices: [deposit] } = await lindaJob(fx);
    scriptLlm(fx);
    const part = await fx.flow.run({
      userId: U,
      conversationId: conv.id,
      content: "Linda paid $425 of the deposit by check",
    });
    assertEquals((await fx.invoices.getOwned(deposit.id, U)).paidCents, 42_500);
    assertStringIncludes(textOf(part.newMessages), "$1,000");

    const fx2 = fresh();
    const two = await signedJob(fx2, {
      customer: { name: "Bob Stone", email: "bob@example.com" },
      job: "Deck",
      totalCents: 150_000,
      invoices: [
        {
          amount: 100_000,
          status: "sent",
          installmentIndex: 1,
          installmentTotal: 2,
        },
        {
          amount: 50_000,
          status: "sent",
          installmentIndex: 2,
          installmentTotal: 2,
        },
      ],
    });
    scriptLlm(fx2);
    const ask = await fx2.flow.run({
      userId: U,
      conversationId: two.conv.id,
      content: "Bob paid by Zelle",
    });
    const said = textOf(ask.newMessages);
    assertStringIncludes(said, two.invoices[0].number!);
    assertStringIncludes(said, two.invoices[1].number!);
    for (const inv of two.invoices) {
      assertEquals((await fx2.payments.listByInvoice(inv.id, U)).length, 0);
    }
  });
});

Deno.test("REQ-583 M2: a payment the chat can place on no invoice (a new chat, nothing billed) is left to the chat model — nothing is recorded", async () => {
  await withKv(async () => {
    const fx = fresh();
    await seedOnboarded();
    await fx.customers.create(U, {
      name: "Ana Ruiz",
      email: "ana@example.com",
    });
    const conv = await fx.conversations.create({ userId: U });
    const chat = scriptLlm(fx, () => ({
      text: "Which invoice is that for? I don't see one for Ana yet.",
    }));
    const res = await fx.flow.run({
      userId: U,
      conversationId: conv.id,
      content: "Ana paid me $500 cash today",
    });
    assertEquals(chat.length, 1, textOf(res.newMessages));
    assertEquals((await fx.payments.listByUser(U)).length, 0);
  });
});

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

Deno.test("REQ-583 M2: pair 3 — 'Invoice Maria for the deep clean' shows the scheduled INV-001 with Send now; 'send it to her now please' sends it", async () => {
  await withKv(async () => {
    const fx = fresh();
    await seedOnboarded();
    const { conv, invoices: [inv] } = await mariaJob(fx);
    const chat = scriptLlm(fx);

    const asked = await fx.flow.run({
      userId: U,
      conversationId: conv.id,
      content: "Invoice Maria for the deep clean",
    });
    assertStringIncludes(textOf(asked.newMessages), "goes out Nov 19"); // REQ-673: one sentence
    const offer = cardsOf(asked.newMessages).find((p) =>
      p.invoiceId === inv.id
    );
    assertEquals(offer?.status, "scheduled");
    assertEquals(
      offer?.offerSend,
      true,
      "no Send-now on the scheduled invoice",
    );
    assertEquals((await fx.invoices.getOwned(inv.id, U)).status, "scheduled");

    const sent = await fx.flow.run({
      userId: U,
      conversationId: conv.id,
      content: "send it to her now please",
    });
    const said = textOf(sent.newMessages);
    assertEquals(chat.length, 0, `the chat model answered: ${said}`);
    const after = await fx.invoices.getOwned(inv.id, U);
    assertEquals(after.status, "sent", `INV-001 was not sent — ${said}`);
    assertEquals(fx.emails.map((e) => e.to), ["maria@example.com"]);
    assertStringIncludes(said, inv.number!);
    assertStringIncludes(said, "$320");
    assertStringIncludes(said, "Maria Lopez");
    assertStringIncludes(said, "email");
    const card = cardsOf(sent.newMessages).find((p) => p.invoiceId === inv.id);
    assertEquals(card?.status, "sent");
    assertEquals(card?.offerSend, undefined);
    assertEquals(sent.conversation.invoiceId, inv.id);
    // nothing new was billed
    assertEquals((await fx.invoices.listByUser(U)).length, 1);
  });
});

Deno.test("REQ-583 M2: pair 3's own data — Maria has only the 555 test number: nothing is delivered, the reply says why, INV-001 stays scheduled with Send now", async () => {
  await withKv(async () => {
    const fx = fresh();
    await seedOnboarded();
    const { conv, invoices: [inv] } = await mariaJob(fx, {
      name: "Maria Lopez",
      phoneNumber: "+15125550199",
    });
    scriptLlm(fx);
    await fx.flow.run({
      userId: U,
      conversationId: conv.id,
      content: "Invoice Maria for the deep clean",
    });
    const res = await fx.flow.run({
      userId: U,
      conversationId: conv.id,
      content: "send it to her now please",
    });
    const said = textOf(res.newMessages);
    assertStringIncludes(said, `${inv.number} not delivered`);
    assertStringIncludes(said, "no email on file");
    assertStringIncludes(said, "still scheduled");
    assertEquals((await fx.invoices.getOwned(inv.id, U)).status, "scheduled");
    assertEquals(fx.texts.length, 0);
    const card = cardsOf(res.newMessages).find((p) => p.invoiceId === inv.id);
    assertEquals(card?.offerSend, true);
  });
});

Deno.test("REQ-583 M2: pair 9 — '…mándale la factura' then 'Mándala ahora por favor, ya terminé hoy' texts INV-001 to Juan, answered in Spanish", async () => {
  await withKv(async () => {
    const fx = fresh();
    await seedOnboarded("es");
    const { conv, invoices: [inv] } = await signedJob(fx, {
      customer: { name: "Juan Pérez", phoneNumber: "+15127770123" },
      job: "Retiro de muebles",
      totalCents: 45_000,
      invoices: [{
        amount: 45_000,
        status: "scheduled",
        scheduledFor: "2026-11-19",
        dueDate: "2026-12-19",
        installmentIndex: 1,
        installmentTotal: 1,
      }],
    });
    const chat = scriptLlm(fx, () => ({
      text:
        "No puedo enviar la factura ahora, ya que está programada para el 19 de noviembre. Puedes ver los detalles en la sección de Facturas.",
    }));
    const first = await fx.flow.run({
      userId: U,
      conversationId: conv.id,
      content: "Ya terminé el trabajo de Juan Pérez, mándale la factura",
    });
    assertEquals(
      cardsOf(first.newMessages).find((p) => p.invoiceId === inv.id)?.offerSend,
      true,
    );
    const res = await fx.flow.run({
      userId: U,
      conversationId: conv.id,
      content: "Mándala ahora por favor, ya terminé hoy",
    });
    const said = textOf(res.newMessages);
    assertEquals(chat.length, 0, `the chat model answered: ${said}`);
    assertEquals((await fx.invoices.getOwned(inv.id, U)).status, "sent");
    assertEquals(fx.texts.map((s) => s.to), ["+15127770123"]);
    assertStringIncludes(said, "INV-001");
    assertStringIncludes(said, "$450");
    assertStringIncludes(said, "Juan Pérez");
    assertStringIncludes(said, "mensaje de texto");
    assert(!/no puedo/i.test(said), said);
  });
});

Deno.test("REQ-583 M2: the card's own words — 'Send INV-001 now' — send that invoice even with no offer in the last reply", async () => {
  await withKv(async () => {
    const fx = fresh();
    await seedOnboarded();
    const { conv, invoices: [inv] } = await mariaJob(fx);
    const chat = scriptLlm(fx);
    const res = await fx.flow.run({
      userId: U,
      conversationId: conv.id,
      content: `Send ${inv.number} now`,
    });
    assertEquals(chat.length, 0, textOf(res.newMessages));
    assertEquals((await fx.invoices.getOwned(inv.id, U)).status, "sent");
  });
});

Deno.test("REQ-583 M2: 'send it now' with no Send-now offer in the last reply is not read as a send (the model decides)", async () => {
  await withKv(async () => {
    const fx = fresh();
    await seedOnboarded();
    const { conv, invoices: [inv] } = await mariaJob(fx);
    const chat = scriptLlm(fx, () => ({ text: "Which one?" }));
    await fx.flow.run({
      userId: U,
      conversationId: conv.id,
      content: "send it now",
    });
    assertEquals(chat.length, 1);
    assertEquals((await fx.invoices.getOwned(inv.id, U)).status, "scheduled");
  });
});

// ---------------------------------------------------------------------------
// A new chat that names the customer (pair 6)
// ---------------------------------------------------------------------------

Deno.test("REQ-583 M2: pair 6 — 'Make the invoice for $450' in a new chat is never a line edit or a change order: it answers where Carmen's bill stands", async () => {
  await withKv(async () => {
    const fx = fresh();
    await seedOnboarded();
    const carmen = await fx.customers.create(U, {
      name: "Carmen Ruiz",
      phoneNumber: "+15127770166",
    });
    const quote = await fx.quotes.create(U, {
      customerId: carmen.id,
      summary: "Reparación de grifo",
      jobName: "Reparación de grifo",
      lineItems: [
        {
          description: "Faucet repair",
          quantity: 1,
          unit: "ea",
          price: 15_000,
        },
        {
          description: "Door adjustment (2)",
          quantity: 1,
          unit: "ea",
          price: 30_000,
        },
      ],
      estimatedTotal: 45_000,
      status: "draft",
    });
    await fx.quotes.update(quote.id, U, {
      status: "sent",
      sentAt: "2026-11-12T15:05:00Z",
    });
    const conv = await fx.conversations.create({ userId: U });
    // what the demo's model did with the sentence
    scriptLlm(fx, () => ({
      text: "",
      action: {
        type: "change_order",
        payload: {
          customerName: "Carmen Ruiz",
          description: "Invoice for faucet and 2 doors",
          deltaAmountCents: 45_000,
        },
      },
    }));

    const res = await fx.flow.run({
      userId: U,
      conversationId: conv.id,
      content:
        "Job done for Carmen Ruiz, faucet and the 2 doors. Make the invoice for $450 please.",
    });

    const said = textOf(res.newMessages);
    assert(!/couldn't find a line/i.test(said), said);
    assertStringIncludes(said, "Carmen Ruiz");
    assertStringIncludes(said, "hasn't signed");
    const after = await fx.quotes.getOwned(quote.id, U);
    assertEquals(after.estimatedTotal, 45_000);
    assertEquals(after.lineItems.length, 2);
    assertEquals(after.pendingRevision, undefined);
    assertEquals((await fx.changeOrders.listByQuote(U, quote.id)).length, 0);
    assertEquals(res.conversation.quoteId, quote.id);
  });
});

Deno.test("REQ-583 M2: pair 6, signed — the new chat binds Carmen's job and shows her scheduled INV-001 with Send now", async () => {
  await withKv(async () => {
    const fx = fresh();
    await seedOnboarded();
    const { quote, invoices: [inv] } = await signedJob(fx, {
      customer: { name: "Carmen Ruiz", email: "carmen@example.com" },
      job: "Reparación de grifo",
      totalCents: 45_000,
      invoices: [{
        amount: 45_000,
        status: "scheduled",
        scheduledFor: "2026-11-19",
        dueDate: "2026-12-19",
        installmentIndex: 1,
        installmentTotal: 1,
      }],
    });
    const conv = await fx.conversations.create({ userId: U });
    const chat = scriptLlm(fx);
    const res = await fx.flow.run({
      userId: U,
      conversationId: conv.id,
      content:
        "Job done for Carmen Ruiz, faucet and the 2 doors. Make the invoice for $450 please.",
    });
    assertEquals(chat.length, 0, textOf(res.newMessages));
    assertEquals(res.conversation.quoteId, quote.id);
    const card = cardsOf(res.newMessages).find((p) => p.invoiceId === inv.id);
    assertEquals(card?.offerSend, true);
  });
});

// ---------------------------------------------------------------------------
// The model's own tools
// ---------------------------------------------------------------------------

Deno.test("REQ-583 M2: the chat model is offered send_invoice + record_payment on a signed job, sees its invoices, and its send_invoice sends the scheduled one", async () => {
  await withKv(async () => {
    const fx = fresh();
    await seedOnboarded();
    const { conv, invoices: [inv] } = await mariaJob(fx);
    const chat = scriptLlm(fx, () => ({
      text: "Sending it now!",
      action: { type: "send_invoice", payload: {} },
    }));
    const res = await fx.flow.run({
      userId: U,
      conversationId: conv.id,
      content: "push the bill out to her today, the job is finished",
    });
    assertEquals(chat.length, 1);
    assert(chat[0].tools?.includes("send_invoice"), "send_invoice not offered");
    assert(
      chat[0].tools?.includes("record_payment"),
      "record_payment not offered",
    );
    assertStringIncludes(chat[0].businessContext ?? "", inv.number!);
    assertStringIncludes(chat[0].businessContext ?? "", "not sent yet");
    assertEquals((await fx.invoices.getOwned(inv.id, U)).status, "sent");
    const said = textOf(res.newMessages);
    assert(!said.includes("Sending it now!"), `the model's prose: ${said}`);
    assertStringIncludes(said, inv.number!);
  });
});

Deno.test("REQ-583 M2: the model's record_payment records it — amount, method and which invoice", async () => {
  await withKv(async () => {
    const fx = fresh();
    await seedOnboarded();
    const { conv, invoices: [deposit] } = await lindaJob(fx);
    scriptLlm(fx, () => ({
      text: "",
      action: {
        type: "record_payment",
        payload: { amountCents: 142_500, method: "zelle", which: "deposit" },
      },
    }));
    const res = await fx.flow.run({
      userId: U,
      conversationId: conv.id,
      content: "Linda's money came through on Zelle this morning",
    });
    assertEquals((await fx.invoices.getOwned(deposit.id, U)).status, "paid");
    assertStringIncludes(textOf(res.newMessages), deposit.number!);
  });
});

Deno.test("REQ-583 M2: a quote nobody signed offers the model neither tool", async () => {
  await withKv(async () => {
    const fx = fresh();
    await seedOnboarded();
    const quote = await fx.quotes.create(U, {
      summary: "Repaint",
      lineItems: [{
        description: "Repaint",
        quantity: 1,
        unit: "ea",
        price: 32_000,
      }],
      estimatedTotal: 32_000,
      status: "draft",
    });
    await fx.quotes.update(quote.id, U, {
      status: "sent",
      sentAt: "2026-11-12T15:00:00Z",
    });
    const conv = await fx.conversations.create({
      userId: U,
      quoteId: quote.id,
      currentPhase: "terms",
    });
    const chat = scriptLlm(fx, () => ({ text: "ok" }));
    await fx.flow.run({
      userId: U,
      conversationId: conv.id,
      content: "what's next?",
    });
    assertEquals(chat.length, 1);
    assert(!chat[0].tools?.includes("send_invoice"));
    assert(!chat[0].tools?.includes("record_payment"));
  });
});

// ---------------------------------------------------------------------------
// REQ-656 (demo-loop cycle 5, run r37f88707, M9) — "job done, invoice X"
// ---------------------------------------------------------------------------

Deno.test("REQ-656 M9: pair 8 — the chip's words typed in a new chat open the invoice flow (customer + amount), never a drafted quote", async () => {
  await withKv(async () => {
    const fx = fresh();
    await seedOnboarded("es");
    const conv = await fx.conversations.create({ userId: U });
    // what the demo's model did with the sentence: a quote, Q-002
    const chat = scriptLlm(fx, () => ({
      text: "",
      action: {
        type: "create_quote",
        payload: {
          summary: "Retiro de refrigerador y lavadora",
          lineItems: [{
            description: "Retiro de refrigerador y lavadora",
            amountCents: 20_000,
          }],
        },
      },
    }));
    const said =
      "Trabajo terminado, necesito facturar: Jorge Ruiz, jorge.ruiz@example.com, sacamos un refrigerador y una lavadora viejos, $200. Que pague hoy.";

    const res = await fx.flow.run({
      userId: U,
      conversationId: conv.id,
      content: said,
    });

    const text = textOf(res.newMessages);
    assertEquals(chat.length, 0, `the chat model answered: ${text}`);
    assertEquals(await fx.quotes.listByUser(U), [], "a quote was drafted");
    assertEquals(cardsOf(res.newMessages), []);
    const reply = res.newMessages.find((m) =>
      m.role === "assistant" && m.kind === "text"
    );
    const flow = (reply?.payload as Record<string, unknown> | undefined)
      ?.invoiceFlow;
    assertEquals(flow, {
      details: said,
      amountCents: 20_000,
      customerName: "Jorge Ruiz",
      customerEmail: "jorge.ruiz@example.com",
    });
    assertStringIncludes(text, "Jorge Ruiz");
    assertStringIncludes(text, "$200");
    assert(!/cotizaci[oó]n/i.test(text), text);
    assertEquals(res.conversation.quoteId, undefined);
  });
});

Deno.test("REQ-656 M9: pair 1 — 'Trabajo terminado, factura a María López…' on a signed pay-on-completion job leads with Send now; nothing is sent without the tap", async () => {
  await withKv(async () => {
    const fx = fresh();
    await seedOnboarded("es");
    const { conv, invoices: [inv] } = await signedJob(fx, {
      customer: { name: "María López", email: "maria@example.com" },
      job: "Corte de césped",
      totalCents: 18_000,
      invoices: [{
        amount: 18_000,
        status: "scheduled",
        scheduledFor: "2026-11-19",
        dueDate: "2026-12-19",
        installmentIndex: 1,
        installmentTotal: 1,
      }],
    });
    const chat = scriptLlm(fx);

    const res = await fx.flow.run({
      userId: U,
      conversationId: conv.id,
      content:
        "Trabajo terminado, factura a María López por la cotización Q-001",
    });

    const text = textOf(res.newMessages);
    assertEquals(chat.length, 0, `the chat model answered: ${text}`);
    assert(!/todav[ií]a no se ha facturado nada/i.test(text), text);
    assertStringIncludes(text, "Enviar ahora");
    assertStringIncludes(text, inv.number!);
    assertStringIncludes(text, "$180");
    const card = cardsOf(res.newMessages).find((p) => p.invoiceId === inv.id);
    assertEquals(card?.offerSend, true);
    assertEquals((await fx.invoices.getOwned(inv.id, U)).status, "scheduled");
    assertEquals(fx.emails.length, 0);
  });
});

Deno.test("REQ-656 M9: a job-done ask in a new chat naming a customer with a signed job binds that job and leads with Send now", async () => {
  await withKv(async () => {
    const fx = fresh();
    await seedOnboarded();
    const { quote, invoices: [inv] } = await mariaJob(fx);
    const conv = await fx.conversations.create({ userId: U });
    const chat = scriptLlm(fx);
    const res = await fx.flow.run({
      userId: U,
      conversationId: conv.id,
      content: "Job done for Maria Lopez, need to invoice her",
    });
    const text = textOf(res.newMessages);
    assertEquals(chat.length, 0, text);
    assertEquals(res.conversation.quoteId, quote.id);
    assertStringIncludes(text, "Send now");
    assertEquals(
      cardsOf(res.newMessages).find((p) => p.invoiceId === inv.id)?.offerSend,
      true,
    );
    assertEquals((await fx.invoices.getOwned(inv.id, U)).status, "scheduled");
  });
});
