/**
 * REQ-925 — Raphael, 2026-11-18: "if i send an invoice, sometimes its in
 * spanish. if in settings english is only selected it should not be possible
 * to get an invoice quote or comunication that is in spanish."
 *
 * Cause: resolveCommsLanguage picked the per-send pick → the customer's own
 * language (REQ-715) → the stored default, and never asked the account's
 * send-in set (identity.commsLanguages). A Spanish customer, a Spanish pick or
 * a stale "es" default all sent Spanish to an English-only account.
 *
 * Integration: the real stores on an in-memory KV, the real renderers; only
 * the email/SMS providers are captured. Every customer-facing send to Carmen
 * (who reads Spanish) is English, because Settings says English only.
 */
import { assert, assertEquals } from "#std/assert";
import { SendPaperworkEmail } from "./send-paperwork-email/mod.ts";
import { SendPaperworkSms } from "./send-paperwork-sms/mod.ts";
import { PreviewQuoteSend } from "./preview-quote-send/mod.ts";
import { PreviewInvoiceSend } from "./preview-invoice-send/mod.ts";
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

const USER = "u-req925";

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

/** Luis (English only in Settings, stale "es" default), Carmen (reads Spanish), Bob (no language). */
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
  // REQ-925: Settings → "Languages you send in" = English only, with a stale
  // Spanish default left behind from before Spanish was unticked.
  await r.identity.upsert(USER, {
    businessName: "Ortega Handyman Services",
    commsLanguages: ["en"],
    commsLanguage: "es",
  });
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

const SPANISH =
  /\b(Hola|Factura|Cotización|Gracias|Recibo|Firmado|Saludo|está lista|te envió)\b|\?lang=es/;

function assertEnglish(text: string | undefined, what: string) {
  assert(text, `${what}: nothing was sent`);
  assert(
    !SPANISH.test(text),
    `${what} must be English (Settings: English only): ${text.slice(0, 200)}`,
  );
}

Deno.test("REQ-925: the stored identity reads its default as English once only English is ticked", async () => {
  const r = rig();
  try {
    await seed(r);
    assertEquals((await r.identity.get(USER))?.commsLanguage, "en");
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-925: an invoice emailed and texted to a Spanish-speaking customer is English when Settings sends in English only", async () => {
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
    assertEnglish(mailed.subject, "invoice email subject");
    assertEnglish(r.emails[0]?.htmlBody, "invoice email body");
    const texted = await r.texter.run(USER, {
      kind: "invoice",
      resourceId: inv.id,
    });
    assertEquals(texted.ok, true, texted.reason);
    assertEnglish(r.texts[0]?.body, "invoice text");
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-925: an explicit Spanish pick on a quote send is refused down to English (email, text, the sending language)", async () => {
  const r = rig();
  try {
    const { carmen, bob } = await seed(r);
    const q = await quoteFor(r, carmen.id);
    const mailed = await r.mailer.run(USER, {
      kind: "quote",
      resourceId: q.id,
      language: "es",
    });
    assertEquals(mailed.ok, true, mailed.reason);
    assertEnglish(mailed.subject, "quote email subject");
    assertEnglish(r.emails[0]?.htmlBody, "quote email body");
    const texted = await r.texter.run(USER, {
      kind: "quote",
      resourceId: q.id,
      language: "es",
    });
    assertEquals(texted.ok, true, texted.reason);
    assertEnglish(r.texts[0]?.body, "quote text");
    assertEquals(await r.mailer.sendLanguage(USER, "es", carmen.id), "en");
    assertEquals(await r.mailer.sendLanguage(USER, undefined, carmen.id), "en");
    assertEquals(await r.mailer.sendLanguage(USER, undefined, bob.id), "en");
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-925: the quote and invoice send previews show English", async () => {
  const r = rig();
  try {
    const { carmen } = await seed(r);
    const q = await quoteFor(r, carmen.id);
    const pq = await new PreviewQuoteSend(
      r.quotes,
      r.customers,
      r.users,
      r.identity,
      r.shortlinks,
    )
      .run(USER, { quoteId: q.id, channel: "both", lang: "es" } as never);
    assertEquals(pq.lang, "en");
    assertEnglish(pq.email?.subject, "quote preview subject");
    assertEnglish(pq.sms?.body, "quote preview text");
    const inv = await r.invoices.create(USER, {
      customerId: carmen.id,
      amount: 450_00,
      status: "draft",
    } as never);
    await r.invoices.update(inv.id, USER, { lang: "es" } as never);
    const pi = await new PreviewInvoiceSend(
      r.invoices,
      r.quotes,
      r.customers,
      r.users,
      r.identity,
      r.shortlinks,
    )
      .run(USER, { invoiceId: inv.id, channel: "both" } as never);
    assertEquals(pi.lang, "en");
    assertEnglish(pi.email?.subject, "invoice preview subject");
    assertEnglish(pi.sms?.body, "invoice preview text");
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-925: overdue reminder, payment receipt, change order and signed confirmation to her are English", async () => {
  const r = rig();
  try {
    const { carmen } = await seed(r);
    // reminder
    await r.invoices.create(USER, {
      customerId: carmen.id,
      amount: 480_00,
      dueDate: "2026-05-01",
      status: "sent",
    } as never);
    await new SendPaymentReminder(
      r.invoices,
      r.customers,
      r.users,
      r.identity,
      r.email,
      r.sms,
      r.shortlinks,
      new EventBus(),
    ).runAll(USER, new Date("2026-05-06T12:00:00Z"));
    assertEnglish(r.emails[0]?.subject, "reminder email");
    assertEnglish(r.texts[0]?.body, "reminder text");

    // receipt
    const payments = new PaymentStore();
    const receiptPdf = new RenderReceiptPdf();
    const receiptLangs: (string | undefined)[] = [];
    receiptPdf.run = (input) => {
      receiptLangs.push(input.lang);
      return Promise.resolve(new Uint8Array([37, 80, 68, 70]));
    };
    const markPaid = new MarkInvoicePaid({} as EmailFlow, r.invoices);
    markPaid.run = () => Promise.resolve();
    const claimed = await r.invoices.create(USER, {
      customerId: carmen.id,
      status: "claimed",
      amount: 450_00,
      paymentIntent: {
        method: "zelle",
        amount: 450_00,
        claimedAt: new Date().toISOString(),
      },
    } as never);
    const before = r.emails.length;
    const out = await new ConfirmPayment(
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
    ).run(USER, claimed.id);
    assertEquals(out.ok, true);
    assertEnglish(r.emails[before]?.subject, "receipt email");
    assertEquals(receiptLangs, ["en"], "the receipt PDF is English");

    // change order
    const changeOrders = new ChangeOrderStore();
    const co = await changeOrders.create(USER, claimed.id, {
      description: "Second coat of paint",
      deltaAmountCents: 120_00,
      customerId: carmen.id,
    });
    const res = await new SendChangeOrderAlert(
      changeOrders,
      r.customers,
      r.users,
      r.identity,
      r.email,
      r.sms,
      r.invoices,
    ).run(co.id);
    assertEquals(res.customer?.approvalPath, `/co/${co.id}?lang=en`);
    assertEnglish(
      r.emails.find((e) =>
        e.to === "carmen@example.com" && /change/i.test(e.subject)
      )?.subject,
      "change order email",
    );

    // signed confirmation
    const pdf = new RenderQuotePdf();
    const pdfLangs: (string | undefined)[] = [];
    pdf.run = (input) => {
      pdfLangs.push(input.commsLanguage);
      return Promise.resolve(new Uint8Array([37, 80, 68, 70]));
    };
    const q = await r.quotes.create(USER, {
      customerId: carmen.id,
      summary: "Faucet repair",
      lineItems: [],
      estimatedTotal: 450_00,
      status: "accepted",
      acceptedAt: new Date().toISOString(),
      acceptedName: "Carmen Ruiz",
    });
    const n = r.emails.length;
    await new SendSignedConfirmation(
      r.quotes,
      r.invoices,
      r.customers,
      r.users,
      r.identity,
      pdf,
      r.email,
      r.sms,
      r.commsLog,
    ).run(q.id);
    assertEnglish(
      r.emails.slice(n).find((e) => e.to === "carmen@example.com")?.subject,
      "signed confirmation",
    );
    assertEquals(pdfLangs, ["en"], "the countersigned PDF is English");
  } finally {
    await resetKv();
  }
});
