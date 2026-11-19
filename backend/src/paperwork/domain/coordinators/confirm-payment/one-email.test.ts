/**
 * REQ-1116 (LOOP-007 cycle 3, issue q3-40) / REQ-963 / REQ-941 — the guard
 * in ConfirmPayment. When the ledger says this confirmed claim CLOSES the
 * bill, the balance coordinator has already emailed the customer the PAID
 * invoice (MarkInvoicePaid, REQ-020); ConfirmPayment must not send a
 * "Receipt for …" email on top, and must let that PAID email carry the
 * receipt PDF (balance.run without `receiptPdf: false`). A claim that leaves
 * a balance still gets its one receipt email.
 *
 * ComputeInvoiceBalance is stubbed (it reports paid / pending and sends
 * nothing); the receipt is the real SendPaymentReceipt with the provider
 * captured, so any email it sends is counted.
 */
import { assertEquals, assertStringIncludes } from "#std/assert";
import { ConfirmPayment } from "./mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { PaymentStore } from "@paperwork/domain/data/payment-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import {
  EmailService,
  type SendEmailInput,
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
import type {
  ComputeInvoiceBalance,
} from "@paperwork/domain/coordinators/compute-invoice-balance/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

const USER = "u-1116";
const CUSTOMER_EMAIL = "dana@test.dev";

function rig(closes: boolean) {
  const invoices = new InvoiceStore();
  const customers = new CustomerStore();
  const email = new EmailService();
  const mails: SendEmailInput[] = [];
  email.send = (input: SendEmailInput) => {
    mails.push(input);
    return Promise.resolve({ ok: true, messageId: `pm-${mails.length}` });
  };
  const commsLog = new LogPaperworkMessage(
    new CommConversationStore(),
    new CommMessageStore(),
  );
  commsLog.run = () => Promise.resolve(undefined);
  commsLog.outbox = () => Promise.resolve(undefined);
  const receiptPdf = new RenderReceiptPdf();
  receiptPdf.run = () => Promise.resolve(new Uint8Array([37, 80, 68, 70]));
  const markPaid = new MarkInvoicePaid({} as SendPaperworkEmail, invoices);
  markPaid.run = () => Promise.resolve();
  // the ledger, stubbed: it reports whether this payment closed the bill
  const balanceCalls: { receiptPdf?: boolean }[] = [];
  const balance = {
    run: async (
      invoiceId: string,
      userId: string,
      opts: { receiptPdf?: boolean } = {},
    ) => {
      balanceCalls.push(opts);
      const status = closes ? "paid" : "pending";
      await invoices.update(invoiceId, userId, { status });
      return {
        invoiceId,
        amount: 100000,
        paidTotal: closes ? 100000 : 40000,
        balance: closes ? 0 : 60000,
        overpaidCents: 0,
        status,
      };
    },
  } as unknown as ComputeInvoiceBalance;
  const flow = new ConfirmPayment(
    invoices,
    new PaymentStore(),
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
    balance,
  );
  return { flow, invoices, customers, mails, balanceCalls };
}

async function claimed(r: ReturnType<typeof rig>, amount: number) {
  const c = await r.customers.create(USER, {
    name: "Dana Customer",
    email: CUSTOMER_EMAIL,
  });
  return await r.invoices.create(
    USER,
    {
      customerId: c.id,
      status: "claimed",
      amount: 100000,
      lineItems: [{ description: "Cedar fence", quantity: 1, price: 100000 }],
      paymentIntent: {
        method: "zelle",
        amount,
        claimedAt: new Date().toISOString(),
      },
    } as unknown as Parameters<InvoiceStore["create"]>[1],
  );
}

async function fresh() {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
}

Deno.test("REQ-1116 (LOOP-007 q3-40) / REQ-963: when the confirmed claim closes the bill, ConfirmPayment sends no 'Receipt for …' email on top of the PAID invoice email", async () => {
  await fresh();
  try {
    const r = rig(true);
    const inv = await claimed(r, 100000);
    const out = await r.flow.run(USER, inv.id);
    assertEquals(out.ok, true);
    assertEquals(
      r.mails.filter((m) => m.to === CUSTOMER_EMAIL).map((m) => m.subject),
      [],
      "the PAID invoice email (MarkInvoicePaid) is the customer's only email — no receipt email from ConfirmPayment",
    );
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-1116 (LOOP-007 q3-40) / REQ-941: when the confirmed claim closes the bill, the PAID invoice email is asked to carry the receipt PDF (balance.run without receiptPdf: false)", async () => {
  await fresh();
  try {
    const r = rig(true);
    const inv = await claimed(r, 100000);
    await r.flow.run(USER, inv.id);
    assertEquals(
      r.balanceCalls.length > 0 &&
        r.balanceCalls.every((o) => o.receiptPdf !== false),
      true,
      `balance.run must let the PAID email attach the receipt PDF; calls: ${
        JSON.stringify(r.balanceCalls)
      }`,
    );
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-1116 (LOOP-007 q3-40) / REQ-963: a confirmed claim that leaves a balance still emails the customer one 'Receipt for …'", async () => {
  await fresh();
  try {
    const r = rig(false);
    const inv = await claimed(r, 40000);
    const out = await r.flow.run(USER, inv.id);
    assertEquals(out.ok, true);
    const toCustomer = r.mails.filter((m) => m.to === CUSTOMER_EMAIL);
    assertEquals(toCustomer.length, 1, "one receipt email");
    assertStringIncludes(toCustomer[0].subject, "Receipt for");
  } finally {
    await resetKv();
  }
});
