/**
 * REQ-523 (demo-loop cycle 3, issue m16): the payment receipt text.
 * ConfirmPayment texted `customer.phoneNumber` with SmsService.send directly
 * and logged a "text" comms-trail row WITHOUT looking at the result — so a
 * receipt "texted" to the demo's 555-01XX customer (pair 9's Mrs Garcia,
 * 5125550142) landed in the trail, and a provider rejection did too.
 *
 * The receipt text now goes through the one guarded customer dispatch
 * (REQ-403's dispatchCustomerSms) and a row is logged only for a real
 * delivery, addressed to the E.164 number dialled.
 */
import { assertEquals } from "#std/assert";
import { ConfirmPayment } from "./mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { PaymentStore } from "@paperwork/domain/data/payment-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { EmailService } from "@communication/domain/data/email-service/mod.ts";
import {
  type SendSmsInput,
  type SendSmsResult,
  SmsService,
} from "@users/domain/data/sms/mod.ts";
import { ShortLinkStore } from "@paperwork/domain/data/shortlink-store/mod.ts";
import { RenderReceiptPdf } from "@paperwork/domain/coordinators/render-receipt-pdf/mod.ts";
import {
  LogPaperworkMessage,
  type LogPaperworkMessageInput,
} from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { ConversationStore as CommConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore as CommMessageStore } from "@communication/domain/data/message-store/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import { MarkInvoicePaid } from "@paperwork/domain/coordinators/mark-invoice-paid/mod.ts";
import type { SendPaperworkEmail } from "@paperwork/domain/coordinators/send-paperwork-email/mod.ts";
import { ComputeInvoiceBalance } from "@paperwork/domain/coordinators/compute-invoice-balance/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

/**
 * `answer` undefined → the REAL SmsService answers (dev mode: no
 * TWILIO_ACCOUNT_SID) — exactly what the demo ran on; otherwise the
 * provider's scripted answer.
 */
function rig(answer?: SendSmsResult) {
  const invoices = new InvoiceStore();
  const payments = new PaymentStore();
  const customers = new CustomerStore();
  const email = new EmailService();
  email.send = () => Promise.resolve({ ok: true, reason: "test_capture" });
  const sms = new SmsService();
  const real = sms.send.bind(sms);
  const texts: SendSmsInput[] = [];
  sms.send = (input: SendSmsInput) => {
    texts.push(input);
    return answer ? Promise.resolve(answer) : real(input);
  };
  const commsLog = new LogPaperworkMessage(
    new CommConversationStore(),
    new CommMessageStore(),
  );
  const logged: LogPaperworkMessageInput[] = [];
  commsLog.run = (input: LogPaperworkMessageInput) => {
    logged.push(input);
    return Promise.resolve(undefined);
  };
  const receiptPdf = new RenderReceiptPdf();
  receiptPdf.run = () => Promise.resolve(new Uint8Array([37, 80, 68, 70]));
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
  return { flow, invoices, customers, texts, logged };
}

/** a sent invoice the customer claimed (Zelle, $450) — what confirm-payment closes */
async function claimedInvoiceFor(
  r: ReturnType<typeof rig>,
  customer: { name: string; phoneNumber?: string; email?: string },
) {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const c = await r.customers.create("u-523", customer);
  return await r.invoices.create(
    "u-523",
    {
      customerId: c.id,
      status: "claimed",
      amount: 450_00,
      lineItems: [{ description: "Panel upgrade", quantity: 1, price: 450_00 }],
      paymentIntent: {
        method: "zelle",
        amount: 450_00,
        claimedAt: new Date().toISOString(),
      },
    } as unknown as Parameters<InvoiceStore["create"]>[1],
  );
}

const textRows = (logged: LogPaperworkMessageInput[]) =>
  logged.filter((l) => l.channel === "text");

Deno.test("REQ-523 (m16) payment receipt: a fictional 555-01XX customer number is never texted and no 'text' comms row is logged", async () => {
  const r = rig();
  try {
    const inv = await claimedInvoiceFor(r, {
      name: "Mrs Garcia",
      phoneNumber: "5125550142",
    });
    const out = await r.flow.run("u-523", inv.id);
    assertEquals(out.ok, true, "the payment itself is recorded");
    assertEquals(
      textRows(r.logged).map((l) => l.toAddress),
      [],
      "a receipt 'text' was logged for a number that cannot get texts",
    );
    assertEquals(r.texts, [], "the fictional number was dialled");
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-523 (m16) payment receipt: a provider rejection logs no 'text' row", async () => {
  const r = rig({ ok: false, reason: "sms.notMobile", code: 21614 });
  try {
    const inv = await claimedInvoiceFor(r, {
      name: "Bo Landline",
      phoneNumber: "+15125551234",
    });
    await r.flow.run("u-523", inv.id);
    assertEquals(r.texts.length, 1, "the real number is tried");
    assertEquals(textRows(r.logged), [], "a rejected text was logged as sent");
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-523 (m16) payment receipt: a real number is texted once, as E.164, and logged once to that number", async () => {
  const r = rig({ ok: true, sid: "SM-523" });
  try {
    const inv = await claimedInvoiceFor(r, {
      name: "Cy Real",
      phoneNumber: "(512) 555-1234",
    });
    await r.flow.run("u-523", inv.id);
    assertEquals(r.texts.map((t) => t.to), ["+15125551234"]);
    assertEquals(
      textRows(r.logged).map((l) => l.toAddress),
      ["+15125551234"],
    );
  } finally {
    await resetKv();
  }
});
