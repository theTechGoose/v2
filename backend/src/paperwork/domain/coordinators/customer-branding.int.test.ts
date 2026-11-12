/**
 * REQ-628 — A2Z Landscape feedback relayed by Raphael, 2026-11-12: "They NEED THEIR LOGO NOT
 * OURS". Every email their customer receives — the quote, the invoice, the receipt, the
 * payment reminder, the change-order request, the signed-agreement confirmation — is headed by
 * the business's own logo (or its name as a wordmark when no logo is on file), leaves under the
 * business's name, and never names or shows DocuMonster.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { getKv, resetKv } from "@core/data/kv/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { ChangeOrderStore } from "@paperwork/domain/data/change-order-store/mod.ts";
import { PaymentStore } from "@paperwork/domain/data/payment-store/mod.ts";
import { ShortLinkStore } from "@paperwork/domain/data/shortlink-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { EmailService, type SendEmailInput } from "@communication/domain/data/email-service/mod.ts";
import { SmsService, type SendSmsInput } from "@users/domain/data/sms/mod.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { ConversationStore as CommConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore as CommMessageStore } from "@communication/domain/data/message-store/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import { SendPaperworkEmail } from "./send-paperwork-email/mod.ts";
import { SendChangeOrderAlert } from "./send-change-order-alert/mod.ts";
import { SendPaymentReminder } from "./send-payment-reminder/mod.ts";
import { SendSignedConfirmation } from "./send-signed-confirmation/mod.ts";
import { ConfirmPayment } from "./confirm-payment/mod.ts";
import { MarkInvoicePaid } from "./mark-invoice-paid/mod.ts";
import { ComputeInvoiceBalance } from "./compute-invoice-balance/mod.ts";
import { RenderReceiptPdf } from "./render-receipt-pdf/mod.ts";
import { RenderQuotePdf } from "./render-quote-pdf/mod.ts";

const USER = "u-628";
const BIZ = "A2Z Landscape LLC";
const FROM = `"${BIZ}" <a2z-landscape-llc@documonster.com>`;

async function withKv(fn: () => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  try {
    await fn();
  } finally {
    await resetKv();
  }
}

async function seedContractor() {
  const kv = await getKv();
  const now = new Date().toISOString();
  await kv.set(["user", USER], {
    id: USER,
    phoneNumber: "+15125550000",
    name: "Alexander Jerez",
    email: "alex@a2z.test",
    createdAt: now,
    updatedAt: now,
  });
}

function capture() {
  const email = new EmailService();
  const sms = new SmsService();
  const emails: SendEmailInput[] = [];
  email.send = (input: SendEmailInput) => {
    emails.push(input);
    return Promise.resolve({ ok: true, reason: "test_capture" });
  };
  sms.send = (_: SendSmsInput) => Promise.resolve({ ok: true });
  return { email, sms, emails };
}

/** the customer-facing email carries their brand and never ours */
function assertTheirBrand(e: SendEmailInput, opts: { logoUrl?: string }) {
  assertEquals(e.from, FROM, `From of "${e.subject}"`);
  assertEquals(/DocuMonster(?!\.com)/i.test(e.htmlBody), false, `"${e.subject}" names DocuMonster`);
  assertEquals(e.htmlBody.includes("logo-email.png"), false, `"${e.subject}" shows the house logo`);
  assertEquals(/DocuMonster/i.test(e.subject), false);
  if (opts.logoUrl) {
    assertStringIncludes(e.htmlBody, opts.logoUrl);
    assertStringIncludes(e.htmlBody, "data-biz-logo");
  } else {
    assertStringIncludes(e.htmlBody, "data-biz-wordmark");
    assertStringIncludes(e.htmlBody, BIZ);
    assertEquals(e.htmlBody.includes("/api/public-logo/"), false);
  }
}

for (const withLogo of [true, false]) {
  const label = withLogo ? "with a logo on file → the logo" : "no logo → the business name as a wordmark";

  Deno.test(`REQ-628 quote + invoice emails (${label}): leave as "${BIZ}" and never show DocuMonster`, async () => {
    await withKv(async () => {
      await seedContractor();
      const identities = new BusinessIdentityStore();
      await identities.upsert(USER, { businessName: BIZ, ...(withLogo ? { logoFileId: "file-a2z" } : {}) });
      const customers = new CustomerStore();
      const quotes = new QuoteStore();
      const invoices = new InvoiceStore();
      const { email, emails } = capture();
      const flow = new SendPaperworkEmail(
        quotes,
        invoices,
        customers,
        new UserStore(),
        identities,
        email,
        new LogPaperworkMessage(new CommConversationStore(), new CommMessageStore()),
      );
      const customer = await customers.create(USER, { name: "Randall Belknap", email: "rb@acme.test" });
      const quote = await quotes.create(USER, {
        customerId: customer.id,
        summary: "Fall cleanup",
        lineItems: [{ description: "Leaves", quantity: 1, unit: "ea", price: 20000 }],
      });
      const invoice = await invoices.create(USER, { customerId: customer.id, status: "draft", jobName: "Maintenance", amount: 6500 });
      assertEquals((await flow.run(USER, { kind: "quote", resourceId: quote.id })).ok, true);
      assertEquals((await flow.run(USER, { kind: "invoice", resourceId: invoice.id })).ok, true);
      assertTheirBrand(emails[0], { logoUrl: withLogo ? `/api/public-logo/quote/${quote.id}` : undefined });
      assertTheirBrand(emails[1], { logoUrl: withLogo ? `/api/public-logo/invoice/${invoice.id}` : undefined });
    });
  });

  Deno.test(`REQ-628 change-order request, payment reminder, receipt and signed confirmation emails (${label}): their brand, never DocuMonster`, async () => {
    await withKv(async () => {
      await seedContractor();
      const identities = new BusinessIdentityStore();
      await identities.upsert(USER, { businessName: BIZ, ...(withLogo ? { logoFileId: "file-a2z" } : {}) });
      const customers = new CustomerStore();
      const quotes = new QuoteStore();
      const invoices = new InvoiceStore();
      const changeOrders = new ChangeOrderStore();
      const payments = new PaymentStore();
      const users = new UserStore();
      const commsLog = new LogPaperworkMessage(new CommConversationStore(), new CommMessageStore());
      const { email, sms, emails } = capture();
      const customer = await customers.create(USER, { name: "Randall Belknap", email: "rb@acme.test" });
      const toCustomer = () => emails.filter((e) => e.to === "rb@acme.test");

      // change-order request (the customer's copy)
      const inv = await invoices.create(USER, {
        customerId: customer.id,
        status: "sent",
        amount: 10000,
        jobName: "Patio",
        dueDate: "2026-01-01",
      });
      const co = await changeOrders.create(USER, inv.id, { description: "Second coat", deltaAmountCents: 2500, customerId: customer.id });
      await new SendChangeOrderAlert(changeOrders, customers, users, identities, email, sms, invoices).run(co.id);
      assertEquals(toCustomer().length, 1, "the change-order request reaches the customer");
      assertTheirBrand(toCustomer()[0], { logoUrl: withLogo ? `/api/public-logo/invoice/${inv.id}` : undefined });

      // payment reminder (day 3)
      const reminder = new SendPaymentReminder(invoices, customers, users, identities, email, sms, new ShortLinkStore(), new EventBus());
      await reminder.runForInvoice(USER, inv.id, 3, new Date("2026-01-05T12:00:00Z"));
      assertEquals(toCustomer().length, 2, "the reminder reaches the customer");
      assertTheirBrand(toCustomer()[1], { logoUrl: withLogo ? `/api/public-logo/invoice/${inv.id}` : undefined });

      // receipt
      await invoices.update(inv.id, USER, {
        status: "claimed",
        paymentIntent: { method: "zelle", amount: 10000, claimedAt: new Date().toISOString() },
      });
      const emailer = new SendPaperworkEmail(quotes, invoices, customers, users, identities, email, commsLog);
      const confirm = new ConfirmPayment(
        invoices,
        payments,
        customers,
        users,
        identities,
        email,
        sms,
        new ShortLinkStore(),
        new RenderReceiptPdf(),
        commsLog,
        new EventBus(),
        new MarkInvoicePaid(emailer),
        new ComputeInvoiceBalance(invoices, payments, new MarkInvoicePaid(emailer)),
      );
      const before = toCustomer().length;
      assertEquals((await confirm.run(USER, inv.id)).ok, true);
      const receipts = toCustomer().slice(before);
      assert(receipts.length >= 1, "the receipt reaches the customer");
      for (const r of receipts) {
        assertTheirBrand(r, { logoUrl: withLogo ? `/api/public-logo/invoice/${inv.id}` : undefined });
      }

      // signed-agreement confirmation
      const quote = await quotes.create(USER, {
        customerId: customer.id,
        summary: "Fall cleanup",
        status: "accepted",
        acceptedAt: new Date().toISOString(),
        acceptedName: "Randall Belknap",
        lineItems: [{ description: "Leaves", quantity: 1, unit: "ea", price: 20000 }],
      } as never);
      const signed = new SendSignedConfirmation(quotes, invoices, customers, users, identities, new RenderQuotePdf(), email, sms, commsLog);
      const beforeSigned = toCustomer().length;
      await signed.run(quote.id);
      const conf = toCustomer().slice(beforeSigned);
      assertEquals(conf.length, 1, "the signed confirmation reaches the customer");
      assertTheirBrand(conf[0], { logoUrl: withLogo ? `/api/public-logo/quote/${quote.id}` : undefined });
    });
  });
}
