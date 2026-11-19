/**
 * REQ-930 — Raphael: "when i mark an invoice as paid, i need a modal to put
 * the reference number." The modal posts confirm-payment with the reference
 * the owner typed; ConfirmPayment records THAT one (trimmed) on the Payment
 * row, the receipt PDF and the receipt email, in place of the customer's
 * claimed reference. An empty entry records none; no option at all (voice,
 * card) keeps the claim's.
 */
import { assertEquals } from "#std/assert";
import { ConfirmPayment } from "./mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { PaymentStore } from "@paperwork/domain/data/payment-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import {
  EmailService,
  type SendEmailInput as EmailMessage,
} from "@communication/domain/data/email-service/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import { ShortLinkStore } from "@paperwork/domain/data/shortlink-store/mod.ts";
import { RenderReceiptPdf } from "@paperwork/domain/coordinators/render-receipt-pdf/mod.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { ConversationStore as CommConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore as CommMessageStore } from "@communication/domain/data/message-store/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import { MarkInvoicePaid } from "@paperwork/domain/coordinators/mark-invoice-paid/mod.ts";
import type { SendPaperworkEmail } from "@paperwork/domain/coordinators/send-paperwork-email/mod.ts";
import { ComputeInvoiceBalance } from "@paperwork/domain/coordinators/compute-invoice-balance/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

const USER = "u-930";

function rig() {
  const invoices = new InvoiceStore();
  const payments = new PaymentStore();
  const customers = new CustomerStore();
  const email = new EmailService();
  const mails: EmailMessage[] = [];
  email.send = (m: EmailMessage) => {
    mails.push(m);
    return Promise.resolve({ ok: true, reason: "test_capture" });
  };
  const sms = new SmsService();
  sms.send = () => Promise.resolve({ ok: true, sid: "SM-930" });
  const commsLog = new LogPaperworkMessage(
    new CommConversationStore(),
    new CommMessageStore(),
  );
  commsLog.run = () => Promise.resolve(undefined);
  commsLog.outbox = () => Promise.resolve(undefined);
  const receiptPdf = new RenderReceiptPdf();
  const pdfRefs: (string | undefined)[] = [];
  receiptPdf.run = (input: Parameters<RenderReceiptPdf["run"]>[0]) => {
    pdfRefs.push(input.reference);
    return Promise.resolve(new Uint8Array([37, 80, 68, 70]));
  };
  const markPaid = new MarkInvoicePaid({} as SendPaperworkEmail, invoices);
  markPaid.run = () => Promise.resolve();
  const flow = new ConfirmPayment(
    invoices,
    payments,
    customers,
    new UserStore(),
    new BusinessIdentityStore(),
    email,
    sms,
    new ShortLinkStore(),
    receiptPdf,
    commsLog,
    new EventBus(),
    markPaid,
    new ComputeInvoiceBalance(invoices, payments, markPaid),
  );
  return { flow, invoices, payments, customers, mails, pdfRefs };
}

/** a sent $500 invoice the customer part-claimed ($300) by Zelle, ref ZL-930 */
async function claimed(r: ReturnType<typeof rig>) {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const c = await r.customers.create(USER, {
    name: "Rita Reference",
    email: "rita@blackhole.postmarkapp.com",
  });
  return await r.invoices.create(
    USER,
    {
      customerId: c.id,
      status: "claimed",
      // REQ-1116: the $300 claim leaves $200 due, so the receipt email (the
      // one REQ-930 checks) is sent — a claim that closes the bill gets the
      // PAID invoice email instead, its PDF built from the Payment row.
      amount: 500_00,
      lineItems: [{ description: "Mowing", quantity: 1, price: 500_00 }],
      paymentIntent: {
        method: "zelle",
        amount: 300_00,
        reference: "ZL-930",
        claimedAt: new Date().toISOString(),
      },
    } as unknown as Parameters<InvoiceStore["create"]>[1],
  );
}

Deno.test("REQ-930 confirm-payment: the owner's entered reference (trimmed) is the one on the Payment, the receipt PDF and the receipt email", async () => {
  const r = rig();
  try {
    const inv = await claimed(r);
    const out = await r.flow.run(USER, inv.id, { reference: "  CHK-1042 " });
    assertEquals(out.ok, true);
    const rows = await r.payments.listByInvoice(inv.id, USER);
    assertEquals(rows.map((p) => p.reference), ["CHK-1042"]);
    assertEquals(r.pdfRefs, ["CHK-1042"], "the receipt PDF's reference");
    assertEquals(r.mails.length, 1, "one receipt email");
    const html = r.mails[0].htmlBody ?? "";
    assertEquals(html.includes("CHK-1042"), true, "the email names it");
    assertEquals(html.includes("ZL-930"), false, "not the claimed one");
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-930 confirm-payment: an emptied reference field records no reference", async () => {
  const r = rig();
  try {
    const inv = await claimed(r);
    await r.flow.run(USER, inv.id, { reference: "   " });
    const rows = await r.payments.listByInvoice(inv.id, USER);
    assertEquals(rows.map((p) => p.reference), [undefined]);
    assertEquals(r.pdfRefs, [undefined]);
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-930 confirm-payment: no reference option (voice / card paths) keeps the customer's claimed reference", async () => {
  const r = rig();
  try {
    const inv = await claimed(r);
    await r.flow.run(USER, inv.id);
    const rows = await r.payments.listByInvoice(inv.id, USER);
    assertEquals(rows.map((p) => p.reference), ["ZL-930"]);
    assertEquals(r.pdfRefs, ["ZL-930"]);
  } finally {
    await resetKv();
  }
});
