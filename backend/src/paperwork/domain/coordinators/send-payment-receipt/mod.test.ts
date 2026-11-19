/**
 * REQ-963 (LOOP-007 cycle 1, q1-37): SendPaymentReceipt — the one payment
 * receipt, extracted from ConfirmPayment so the Record payment dialog
 * (POST /payments) sends it for a part payment too. Against a fake email and
 * SMS provider on an in-memory KV.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { SendPaymentReceipt } from "./mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import {
  EmailService,
  type SendEmailInput,
  type SendEmailResult,
} from "@communication/domain/data/email-service/mod.ts";
import {
  type SendSmsInput,
  type SendSmsResult,
  SmsService,
} from "@users/domain/data/sms/mod.ts";
import { ShortLinkStore } from "@paperwork/domain/data/shortlink-store/mod.ts";
import { RenderReceiptPdf } from "@paperwork/domain/coordinators/render-receipt-pdf/mod.ts";
import {
  LogPaperworkMessage,
  type OutboxRecordInput,
} from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { ConversationStore as CommConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore as CommMessageStore } from "@communication/domain/data/message-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

const USER = "u-963";

function rig(
  emailAnswer: SendEmailResult = { ok: true },
  smsAnswer: SendSmsResult = { ok: true },
) {
  const invoices = new InvoiceStore();
  const customers = new CustomerStore();
  const users = new UserStore();
  const email = new EmailService();
  const mails: SendEmailInput[] = [];
  email.send = (input: SendEmailInput) => {
    mails.push(input);
    return Promise.resolve(emailAnswer);
  };
  const sms = new SmsService();
  const texts: SendSmsInput[] = [];
  sms.send = (input: SendSmsInput) => {
    texts.push(input);
    return Promise.resolve(smsAnswer);
  };
  const commsLog = new LogPaperworkMessage(
    new CommConversationStore(),
    new CommMessageStore(),
  );
  commsLog.run = () => Promise.resolve(undefined);
  const outbox: OutboxRecordInput[] = [];
  commsLog.outbox = (input: OutboxRecordInput) => {
    outbox.push(input);
    return Promise.resolve(undefined);
  };
  const receiptPdf = new RenderReceiptPdf();
  receiptPdf.run = () => Promise.resolve(new Uint8Array([37, 80, 68, 70]));
  const flow = new SendPaymentReceipt(
    invoices,
    customers,
    users,
    new BusinessIdentityStore(),
    email,
    sms,
    new ShortLinkStore(),
    receiptPdf,
    commsLog,
  );
  return { flow, invoices, customers, users, mails, texts, outbox };
}

async function pendingInvoice(
  r: ReturnType<typeof rig>,
  customer: { name: string; email?: string; phoneNumber?: string },
) {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  await resetKv();
  const c = await r.customers.create(USER, customer);
  return await r.invoices.create(
    USER,
    {
      customerId: c.id,
      status: "pending",
      amount: 1000_00,
      paidCents: 400_00,
    } as unknown as Parameters<InvoiceStore["create"]>[1],
  );
}

const PAYMENT = {
  amount: 400_00,
  method: "check" as const,
  reference: "1042",
  receivedAt: "2026-11-18T15:00:00.000Z",
};

Deno.test("REQ-963 SendPaymentReceipt: a part payment emails the customer the receipt (PDF attached), texts them, lists both in the outbox and stamps receiptSentVia email", async () => {
  const r = rig();
  try {
    const inv = await pendingInvoice(r, {
      name: "Pat Doe",
      email: "pat@test.dev",
      phoneNumber: "+15125550963",
    });
    const out = await r.flow.run(USER, inv.id, PAYMENT);
    assertEquals(out.emailed, true);
    assertEquals(r.mails.length, 1);
    const mail = r.mails[0];
    assertEquals(mail.to, "pat@test.dev");
    assertStringIncludes(mail.subject, "Receipt for");
    assertStringIncludes(mail.htmlBody ?? "", "$400");
    assert(
      mail.attachments?.some((a) => a.contentType === "application/pdf"),
      "the receipt PDF is attached",
    );
    assertEquals(
      r.outbox.filter((o) => o.kind === "receipt" && o.channel === "email")
        .length,
      1,
    );
    assertEquals(r.texts.length, 1, "the receipt text");
    assertStringIncludes(r.texts[0].body, "$400");
    assertEquals(out.texted, true);
    assertEquals((await r.invoices.get(inv.id)).receiptSentVia, "email");
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-963 SendPaymentReceipt: the contractor is cc'd and a pending invoice gets receiptSentVia email", async () => {
  const r = rig();
  try {
    Deno.env.set("KV_PATH", ":memory:");
    await resetKv();
    const owner = await r.users.create(
      {
        phoneNumber: "+15125550101",
        name: "Luis Ortega",
        email: "luis@test.dev",
      } as unknown as Parameters<UserStore["create"]>[0],
    );
    const c = await r.customers.create(owner.id, {
      name: "Pat Doe",
      email: "pat@test.dev",
    });
    const inv = await r.invoices.create(
      owner.id,
      {
        customerId: c.id,
        status: "pending",
        amount: 1000_00,
      } as unknown as Parameters<InvoiceStore["create"]>[1],
    );
    const out = await r.flow.run(owner.id, inv.id, PAYMENT);
    assertEquals(out.emailed, true);
    assertEquals(r.mails[0].cc, ["luis@test.dev"]);
    assertEquals((await r.invoices.get(inv.id)).receiptSentVia, "email");
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-963 SendPaymentReceipt: no email and no phone on file → nothing sent, receiptSentVia none, never throws", async () => {
  const r = rig();
  try {
    const inv = await pendingInvoice(r, { name: "Pat Doe" });
    const out = await r.flow.run(USER, inv.id, PAYMENT);
    assertEquals(out, {
      emailed: false,
      texted: false,
      customerName: "Pat Doe",
    });
    assertEquals(r.mails.length, 0);
    assertEquals(r.texts.length, 0);
    assertEquals((await r.invoices.get(inv.id)).receiptSentVia, "none");
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-963 SendPaymentReceipt: a refused email is in the outbox as not sent and the stamp says text when only the text got through", async () => {
  const r = rig({ ok: false, reason: "provider down" });
  try {
    const inv = await pendingInvoice(r, {
      name: "Pat Doe",
      email: "pat@test.dev",
      phoneNumber: "+15125550963",
    });
    const out = await r.flow.run(USER, inv.id, PAYMENT);
    assertEquals(out.emailed, false);
    assertEquals(out.texted, true);
    const row = r.outbox.find((o) => o.channel === "email");
    assertEquals(row?.ok, false);
    assertEquals((await r.invoices.get(inv.id)).receiptSentVia, "text");
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-963 SendPaymentReceipt: an invoice that is not the caller's → nothing sent, no throw", async () => {
  const r = rig();
  try {
    const inv = await pendingInvoice(r, {
      name: "Pat Doe",
      email: "pat@test.dev",
    });
    const out = await r.flow.run("someone-else", inv.id, PAYMENT);
    assertEquals(out, { emailed: false, texted: false });
    assertEquals(r.mails.length, 0);
  } finally {
    await resetKv();
  }
});
