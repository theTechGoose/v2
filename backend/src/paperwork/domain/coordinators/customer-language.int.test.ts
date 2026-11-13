/**
 * REQ-715 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 5, issue m31 "No per-client language" (with c2-M29,
 * c3-m43, c4-M34). Every customer-facing send resolved its language as the
 * per-send pick → the ACCOUNT's commsLanguage → en
 * (shared/quote-flow/comms-language.ts), and the reminder read
 * `biz?.commsLanguage` directly — so a Spanish-speaking client got English
 * reminders, invoices and texts, and the contractor had nowhere to say so.
 *
 * Customer.language now sits between the pick and the account default in
 * every dispatcher: quote + invoice email and text, the send preview,
 * SendQuote's recorded language, overdue reminders, payment receipts, the
 * change-order request and the signed confirmation. A pick that is just the
 * customer's own language is never adopted as the ACCOUNT default (UX-28's
 * adopt-the-first-pick rule still holds for any other pick).
 *
 * Integration: the real stores on an in-memory KV, the real renderers; only
 * the email/SMS providers are captured.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { SendPaperworkEmail } from "./send-paperwork-email/mod.ts";
import { SendPaperworkSms } from "./send-paperwork-sms/mod.ts";
import { PreviewQuoteSend } from "./preview-quote-send/mod.ts";
import { SendPaymentReminder } from "./send-payment-reminder/mod.ts";
import { SendChangeOrderAlert } from "./send-change-order-alert/mod.ts";
import { SendSignedConfirmation } from "./send-signed-confirmation/mod.ts";
import { ConfirmPayment } from "./confirm-payment/mod.ts";
import { MarkInvoicePaid } from "./mark-invoice-paid/mod.ts";
import { ComputeInvoiceBalance } from "./compute-invoice-balance/mod.ts";
import { RenderReceiptPdf } from "./render-receipt-pdf/mod.ts";
import { RenderQuotePdf } from "./render-quote-pdf/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { PaymentStore } from "@paperwork/domain/data/payment-store/mod.ts";
import { ChangeOrderStore } from "@paperwork/domain/data/change-order-store/mod.ts";
import { ShortLinkStore } from "@paperwork/domain/data/shortlink-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import type { CreateCustomerDto } from "@crm/dto/customer.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import {
  EmailService,
  type SendEmailInput,
} from "@communication/domain/data/email-service/mod.ts";
import { type SendSmsInput, SmsService } from "@users/domain/data/sms/mod.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { ConversationStore as CommConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore as CommMessageStore } from "@communication/domain/data/message-store/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";
import type { SendPaperworkEmail as EmailFlow } from "./send-paperwork-email/mod.ts";

const USER = "u-req715";

function rig() {
  const quotes = new QuoteStore();
  const invoices = new InvoiceStore();
  const customers = new CustomerStore();
  const users = new UserStore();
  const identity = new BusinessIdentityStore();
  const shortlinks = new ShortLinkStore();
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
    return Promise.resolve({ ok: true, sid: "SM-715" });
  };
  const commsLog = new LogPaperworkMessage(
    new CommConversationStore(),
    new CommMessageStore(),
  );
  commsLog.run = () => Promise.resolve(undefined);
  const mailer = new SendPaperworkEmail(
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
    shortlinks,
    commsLog,
  );
  return {
    quotes,
    invoices,
    customers,
    users,
    identity,
    shortlinks,
    email,
    sms,
    commsLog,
    emails,
    texts,
    mailer,
    texter,
  };
}

/** Luis (English app, no account send default yet), Carmen (reads Spanish), Bob (no language). */
async function seed(r: ReturnType<typeof rig>) {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const kv = await getKv();
  const now = new Date().toISOString();
  await kv.set(["user", USER], {
    id: USER,
    phoneNumber: "+15125557100",
    name: "Luis Ortega",
    email: "luis@test.dev",
    language: "en",
    createdAt: now,
    updatedAt: now,
  });
  await r.identity.upsert(USER, { businessName: "Ortega Handyman Services" });
  const carmen = await r.customers.create(USER, {
    name: "Carmen Ruiz",
    email: "carmen@example.com",
    phoneNumber: "+15125557151",
    language: "es",
  } as CreateCustomerDto);
  const bob = await r.customers.create(USER, {
    name: "Bob Smith",
    email: "bob@example.com",
    phoneNumber: "+15125557152",
  });
  return { carmen, bob };
}

function quoteFor(r: ReturnType<typeof rig>, customerId: string) {
  return r.quotes.create(USER, {
    customerId,
    summary: "Faucet repair and 2 interior doors",
    jobName: "Faucet Repair",
    jobNameByLang: { en: "Faucet Repair", es: "Reparación de grifo" },
    lineItems: [{
      description: "Faucet + 2 doors",
      quantity: 1,
      unit: "ea",
      price: 450_00,
    }],
    estimatedTotal: 450_00,
    status: "draft",
  });
}

async function storedDefault(r: ReturnType<typeof rig>) {
  return (await r.identity.get(USER))?.commsLanguage;
}

Deno.test("REQ-715 m31: an invoice emailed and texted to a Spanish-speaking customer goes out in Spanish with no pick, and the account default stays unset", async () => {
  const r = rig();
  try {
    const { carmen } = await seed(r);
    const inv = await r.invoices.create(USER, {
      customerId: carmen.id,
      amount: 450_00,
      dueDate: "2026-12-01",
      status: "sent",
    } as never);

    const mailed = await r.mailer.run(USER, {
      kind: "invoice",
      resourceId: inv.id,
    });
    assertEquals(mailed.ok, true, mailed.reason);
    assert(
      mailed.subject.startsWith("Factura "),
      `the invoice email is Spanish: ${mailed.subject}`,
    );

    const texted = await r.texter.run(USER, {
      kind: "invoice",
      resourceId: inv.id,
    });
    assertEquals(texted.ok, true, texted.reason);
    assertStringIncludes(r.texts[0].body, "Gracias por confiar en nosotros");
    assertStringIncludes(r.texts[0].body, "?lang=es");

    assertEquals(
      await storedDefault(r),
      undefined,
      "no pick → nothing is adopted as the account default",
    );
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-715 m31: a quote sent with no pick goes out in her language; the per-send pick still wins", async () => {
  const r = rig();
  try {
    const { carmen } = await seed(r);
    const q = await quoteFor(r, carmen.id);

    const spanish = await r.mailer.run(USER, {
      kind: "quote",
      resourceId: q.id,
    });
    assertEquals(spanish.ok, true, spanish.reason);
    assert(
      spanish.subject.startsWith("Cotización "),
      `no pick → her language: ${spanish.subject}`,
    );
    assertStringIncludes(r.emails[0].htmlBody, `/q/${q.id}?lang=es`);

    const english = await r.mailer.run(USER, {
      kind: "quote",
      resourceId: q.id,
      language: "en",
    });
    assert(
      english.subject.startsWith("Quote "),
      `the pick wins over her language: ${english.subject}`,
    );
    assertStringIncludes(r.emails[1].htmlBody, `/q/${q.id}?lang=en`);
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-715 m31: SendQuote's recorded send language and the send preview start from the customer's language", async () => {
  const r = rig();
  try {
    const { carmen, bob } = await seed(r);
    const q = await quoteFor(r, carmen.id);

    assertEquals(await r.mailer.sendLanguage(USER, undefined, carmen.id), "es");
    assertEquals(await r.mailer.sendLanguage(USER, "en", carmen.id), "en");
    assertEquals(await r.mailer.sendLanguage(USER, undefined, bob.id), "en");

    const preview = new PreviewQuoteSend(
      r.quotes,
      r.customers,
      r.users,
      r.identity,
      r.shortlinks,
    );
    const p = await preview.run(USER, { quoteId: q.id, channel: "both" });
    assertEquals(p.lang, "es");
    assert(
      p.email?.subject.startsWith("Cotización "),
      `the preview shows what she gets: ${p.email?.subject}`,
    );
    assertStringIncludes(p.sms?.body ?? "", "?lang=es");
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-715: a pick that is just the customer's own language never becomes the account default; a pick for a customer with none still does (UX-28)", async () => {
  const r = rig();
  try {
    const { carmen, bob } = await seed(r);
    const qCarmen = await quoteFor(r, carmen.id);
    const qBob = await quoteFor(r, bob.id);

    await r.mailer.run(USER, {
      kind: "quote",
      resourceId: qCarmen.id,
      language: "es",
    });
    await r.texter.run(USER, {
      kind: "quote",
      resourceId: qCarmen.id,
      language: "es",
    });
    assertEquals(
      await storedDefault(r),
      undefined,
      "Carmen's Spanish is hers, not the account's",
    );

    await r.texter.run(USER, {
      kind: "quote",
      resourceId: qBob.id,
      language: "es",
    });
    assertEquals(
      await storedDefault(r),
      "es",
      "a pick for a customer with no language is still adopted",
    );
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-715 m31: an overdue reminder to her is in Spanish, and its link opens the invoice in Spanish", async () => {
  const r = rig();
  try {
    const { carmen } = await seed(r);
    await r.invoices.create(USER, {
      customerId: carmen.id,
      amount: 480_00,
      dueDate: "2026-05-01",
      status: "sent",
    } as never);
    const reminders = new SendPaymentReminder(
      r.invoices,
      r.customers,
      r.users,
      r.identity,
      r.email,
      r.sms,
      r.shortlinks,
      new EventBus(),
    );
    const fired = await reminders.runAll(
      USER,
      new Date("2026-05-06T12:00:00Z"),
    );
    assertEquals(fired.map((f) => f.day), [3]);
    assert(
      r.emails[0].subject.startsWith("Saludo rápido: factura de Ortega"),
      r.emails[0].subject,
    );
    assertStringIncludes(r.texts[0].body, "?lang=es");
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-715: her payment receipt is in Spanish — email, PDF — and its text links the invoice in Spanish", async () => {
  const r = rig();
  try {
    const { carmen } = await seed(r);
    const payments = new PaymentStore();
    const receiptPdf = new RenderReceiptPdf();
    const receiptLangs: (string | undefined)[] = [];
    receiptPdf.run = (input) => {
      receiptLangs.push(input.lang);
      return Promise.resolve(new Uint8Array([37, 80, 68, 70]));
    };
    const markPaid = new MarkInvoicePaid({} as EmailFlow, r.invoices);
    markPaid.run = () => Promise.resolve();
    const confirm = new ConfirmPayment(
      r.invoices,
      payments,
      r.customers,
      r.users,
      r.identity,
      r.email,
      r.sms,
      r.shortlinks,
      receiptPdf,
      r.commsLog,
      new EventBus(),
      markPaid,
      new ComputeInvoiceBalance(r.invoices, payments, markPaid),
    );
    const inv = await r.invoices.create(USER, {
      customerId: carmen.id,
      status: "claimed",
      amount: 450_00,
      paymentIntent: {
        method: "zelle",
        amount: 450_00,
        claimedAt: new Date().toISOString(),
      },
    } as never);
    const out = await confirm.run(USER, inv.id);
    assertEquals(out.ok, true);
    assert(
      r.emails[0]?.subject.startsWith("Recibo de "),
      `the receipt is Spanish: ${r.emails[0]?.subject}`,
    );
    assertEquals(
      receiptLangs,
      ["es"],
      "the receipt PDF is her copy, in Spanish",
    );
    const receiptText = r.texts.find((x) => x.to === "+15125557151");
    assertStringIncludes(receiptText?.body ?? "", "?lang=es");
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-715: a change order asks her in Spanish and its link opens /co in Spanish", async () => {
  const r = rig();
  try {
    const { carmen } = await seed(r);
    const inv = await r.invoices.create(USER, {
      customerId: carmen.id,
      amount: 450_00,
      status: "sent",
    } as never);
    const changeOrders = new ChangeOrderStore();
    const co = await changeOrders.create(USER, inv.id, {
      description: "Second coat of paint",
      deltaAmountCents: 120_00,
      customerId: carmen.id,
    });
    const alert = new SendChangeOrderAlert(
      changeOrders,
      r.customers,
      r.users,
      r.identity,
      r.email,
      r.sms,
      r.invoices,
    );
    const res = await alert.run(co.id);
    assertEquals(res.customer?.approvalPath, `/co/${co.id}?lang=es`);
    const toHer = r.emails.find((e) => e.to === "carmen@example.com");
    assert(
      toHer?.subject.startsWith("Ortega Handyman Services te envió un cambio"),
      `the request is Spanish: ${toHer?.subject}`,
    );
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-715: the confirmation she gets after signing — email and its PDF — is in Spanish", async () => {
  const r = rig();
  try {
    const { carmen } = await seed(r);
    const pdf = new RenderQuotePdf();
    const pdfLangs: (string | undefined)[] = [];
    pdf.run = (input) => {
      pdfLangs.push(input.commsLanguage);
      return Promise.resolve(new Uint8Array([37, 80, 68, 70]));
    };
    const signed = new SendSignedConfirmation(
      r.quotes,
      r.invoices,
      r.customers,
      r.users,
      r.identity,
      pdf,
      r.email,
      r.sms,
      r.commsLog,
    );
    const q = await r.quotes.create(USER, {
      customerId: carmen.id,
      summary: "Reparación de grifo",
      lineItems: [],
      estimatedTotal: 450_00,
      status: "accepted",
      acceptedAt: new Date().toISOString(),
      acceptedName: "Carmen Ruiz",
    });
    await signed.run(q.id);
    const toHer = r.emails.find((e) => e.to === "carmen@example.com");
    assert(
      toHer?.subject.startsWith("Firmado:"),
      `the confirmation is Spanish: ${toHer?.subject}`,
    );
    assertEquals(
      pdfLangs,
      ["es"],
      "the countersigned PDF is her copy, in Spanish",
    );
  } finally {
    await resetKv();
  }
});
