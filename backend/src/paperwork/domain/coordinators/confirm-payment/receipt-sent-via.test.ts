/**
 * REQ-556 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 4, issue M7 (pair 9): the client had no email and a
 * fictional 555-01XX number; after the contractor confirmed the Zelle claim,
 * /invoices said "El recibo se envió automáticamente." and /i "Un recibo en
 * PDF está en tu correo". ConfirmPayment now records where its receipt
 * actually went (`receiptSentVia`): "email" when an email was delivered,
 * "text" when only the text was, "none" when nothing could be.
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
  type SendEmailResult,
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

/** SMS in dev mode (the real guarded service, no TWILIO_ACCOUNT_SID) — what
 *  the demo ran on. The PAID-invoice email (MarkInvoicePaid) finds no
 *  address for a customer without one, exactly like SendPaperworkEmail. */
function rig(emailAnswer: SendEmailResult = { ok: true }) {
  const invoices = new InvoiceStore();
  const payments = new PaymentStore();
  const customers = new CustomerStore();
  const email = new EmailService();
  email.send = () => Promise.resolve(emailAnswer);
  const commsLog = new LogPaperworkMessage(
    new CommConversationStore(),
    new CommMessageStore(),
  );
  commsLog.run = () => Promise.resolve(undefined);
  const receiptPdf = new RenderReceiptPdf();
  receiptPdf.run = () => Promise.resolve(new Uint8Array([37, 80, 68, 70]));
  const paidEmail = {
    run: async (userId: string, input: { resourceId: string }) => {
      const inv = await invoices.getOwned(input.resourceId, userId);
      const c = inv.customerId
        ? await customers.getOwned(inv.customerId, userId)
        : undefined;
      return c?.email
        ? { ...emailAnswer, to: c.email, subject: "Paid" }
        : { ok: false, reason: "no recipient", to: "", subject: "Paid" };
    },
  } as unknown as SendPaperworkEmail;
  const markPaid = new MarkInvoicePaid(paidEmail, invoices);
  const flow = new ConfirmPayment(
    invoices,
    payments,
    customers,
    new UserStore(),
    new BusinessIdentityStore(),
    email,
    new SmsService(),
    new ShortLinkStore(),
    receiptPdf,
    commsLog,
    new EventBus(),
    markPaid,
    new ComputeInvoiceBalance(invoices, payments, markPaid),
  );
  return { flow, invoices, customers };
}

async function confirmFor(
  r: ReturnType<typeof rig>,
  customer: { name: string; phoneNumber?: string; email?: string },
): Promise<string | undefined> {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const c = await r.customers.create("u-556", customer);
  const inv = await r.invoices.create(
    "u-556",
    {
      customerId: c.id,
      status: "claimed",
      amount: 450_00,
      paymentIntent: {
        method: "zelle",
        amount: 450_00,
        claimedAt: new Date().toISOString(),
      },
    } as unknown as Parameters<InvoiceStore["create"]>[1],
  );
  const out = await r.flow.run("u-556", inv.id);
  assertEquals(out.ok, true, "the payment itself is recorded");
  const after = await r.invoices.get(inv.id);
  assertEquals(after.status, "paid");
  return after.receiptSentVia;
}

Deno.test("REQ-556 (M7) confirm payment: no email and a fictional 555-01XX number (pair 9) → receiptSentVia 'none'", async () => {
  try {
    assertEquals(
      await confirmFor(rig(), {
        name: "Mrs Garcia",
        phoneNumber: "5125550142",
      }),
      "none",
    );
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-556 (M7) confirm payment: no contact at all → receiptSentVia 'none'", async () => {
  try {
    assertEquals(await confirmFor(rig(), { name: "No Contact" }), "none");
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-556 (M7) confirm payment: a real number and no email → receiptSentVia 'text'", async () => {
  try {
    assertEquals(
      await confirmFor(rig(), {
        name: "Cy Real",
        phoneNumber: "(512) 555-1234",
      }),
      "text",
    );
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-556 (M7) confirm payment: an email that was delivered → receiptSentVia 'email'", async () => {
  try {
    assertEquals(
      await confirmFor(rig(), { name: "Di Mail", email: "di@example.com" }),
      "email",
    );
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-556 (M7) confirm payment: the email bounced and the number is fictional → receiptSentVia 'none'", async () => {
  try {
    assertEquals(
      await confirmFor(rig({ ok: false, reason: "bounced" }), {
        name: "Di Bounce",
        email: "di@example.com",
        phoneNumber: "5125550142",
      }),
      "none",
    );
  } finally {
    await resetKv();
  }
});
