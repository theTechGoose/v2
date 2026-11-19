/**
 * REQ-1116 (LOOP-007 cycle 3, issue q3-40) / REQ-963 / REQ-941 over HTTP on
 * the booted app. QA's customer made a Zelle claim for the whole balance on
 * /i, the contractor pressed "Okay, I got it" → "Mark as paid" (POST
 * /invoices/:id/confirm-payment), and the customer got TWO emails in the same
 * second: "Paid — Invoice INV-001 from …" and "Receipt for INV-001".
 *
 * REQ-963: the payment that closes the balance sends exactly ONE customer
 * email (the PAID invoice), never a receipt on top — the hand-recorded path
 * (POST /payments) already does; the claim-confirm path must too. That one
 * email carries the receipt PDF (REQ-941) and receiptSentVia is "email".
 *
 * A confirmed claim that leaves a balance (the assistant's part payment)
 * still emails one "Receipt for …".
 *
 * Only the email provider is captured (EmailService.send); everything else
 * is the real app on an in-memory KV.
 */
import "#reflect-metadata";
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { CrmModule } from "@crm/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { CommunicationModule } from "@communication/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import {
  EmailService,
  type SendEmailInput,
} from "@communication/domain/data/email-service/mod.ts";

@Module({
  imports: [UsersModule, CrmModule, CommunicationModule, PaperworkModule],
})
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const BASE = `http://localhost:${PORT}`;
const json = { "content-type": "application/json" };
const OWNER_EMAIL = "whitfield.owner@test.dev";
const CUSTOMER_EMAIL = "dana.customer@test.dev";

// the provider, captured: every email the app hands to Postmark
const mails: SendEmailInput[] = [];
EmailService.prototype.send = function (input: SendEmailInput) {
  mails.push(input);
  return Promise.resolve({ ok: true, messageId: `pm-${mails.length}` });
};
const toCustomer = () => mails.filter((m) => m.to === CUSTOMER_EMAIL);
const sent = () =>
  JSON.stringify(mails.map((m) => ({ to: m.to, subject: m.subject })));

async function login(phone: string): Promise<Record<string, string>> {
  await (await fetch(`${BASE}/auth/send-otp`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ phoneNumber: phone }),
  })).body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${BASE}/auth/verify-otp`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  const users = new UserStore();
  const me = await users.findByPhone(phone);
  await users.update(me!.id, { name: "Sam Whitfield", email: OWNER_EMAIL });
  return { ...json, "x-session-id": v.sessionId };
}

async function call(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

async function withServer(fn: () => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  await resetKv();
  mails.length = 0;
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    await fn();
  } finally {
    await server.stop();
    await resetKv();
  }
}

/** a sent $1,000 invoice to Dana, who has an email on file (no phone) */
async function sentInvoice(auth: Record<string, string>) {
  const customer = await call("POST", "/customers", auth, {
    name: "Dana Customer",
    email: CUSTOMER_EMAIL,
  });
  assertEquals(customer.status < 400, true, JSON.stringify(customer.body));
  const inv = await call("POST", "/invoices", auth, {
    customerId: customer.body.id,
    jobName: "Cedar fence",
    amount: 100000,
    status: "sent",
    dueDate: "2026-12-01",
  });
  assertEquals(inv.status < 400, true, JSON.stringify(inv.body));
  return inv.body as { id: string; userId: string; number?: string };
}

async function emailOutboxRows(auth: Record<string, string>) {
  const outbox = await call("GET", "/outbox", auth);
  assertEquals(outbox.status, 200, JSON.stringify(outbox.body));
  return (outbox.body as { channel: string; to?: string; kind: string }[])
    .filter((r) => r.channel === "email" && r.to === CUSTOMER_EMAIL);
}

Deno.test("REQ-1116 (LOOP-007 q3-40) / REQ-963: confirming a Zelle claim for the whole balance sends the customer exactly ONE email — the PAID invoice with the receipt PDF — one outbox row, receiptSentVia 'email'", async () => {
  await withServer(async () => {
    const auth = await login("+15125551116");
    const inv = await sentInvoice(auth);

    // the customer, on /i: Zelle → "I sent it" (the whole balance)
    const claim = await call(
      "POST",
      `/invoices/${inv.id}/claim-payment`,
      json,
      {
        method: "zelle",
        claimedBy: "Dana Customer",
      },
    );
    assertEquals(claim.status, 200, JSON.stringify(claim.body));
    mails.length = 0; // only what the confirm sends
    const outboxBefore = (await emailOutboxRows(auth)).length;

    // the owner, on /invoices: "Okay, I got it" → "Mark as paid"
    const confirm = await call(
      "POST",
      `/invoices/${inv.id}/confirm-payment`,
      auth,
      {},
    );
    assertEquals(confirm.status < 300, true, JSON.stringify(confirm.body));
    const after = await call("GET", `/invoices/${inv.id}`, auth);
    assertEquals(after.body.status, "paid");

    const emails = toCustomer();
    assertEquals(
      emails.length,
      1,
      `REQ-963: exactly one customer email when the claim closes the bill; sent: ${sent()}`,
    );
    assertEquals(
      emails[0].attachments?.filter((a) => a.contentType === "application/pdf")
        .length,
      1,
      "the one email carries the receipt PDF (REQ-941)",
    );
    assertEquals(
      (await emailOutboxRows(auth)).length - outboxBefore,
      1,
      `the outbox gains exactly one customer email; sent: ${sent()}`,
    );
    assertEquals(after.body.receiptSentVia, "email");
  });
});

Deno.test("REQ-1116 (LOOP-007 q3-40) / REQ-963: a confirmed claim that leaves a balance still emails the customer one 'Receipt for …' with the PDF", async () => {
  await withServer(async () => {
    const auth = await login("+15125552116");
    const inv = await sentInvoice(auth);
    // the assistant's part payment: a $400 claim on the $1,000 bill
    const store = new InvoiceStore();
    const owned = await store.get(inv.id);
    await store.update(inv.id, owned.userId, {
      status: "claimed",
      paymentIntent: {
        method: "zelle",
        amount: 40000,
        claimedAt: new Date().toISOString(),
      },
    });
    mails.length = 0;

    const confirm = await call(
      "POST",
      `/invoices/${inv.id}/confirm-payment`,
      auth,
      {},
    );
    assertEquals(confirm.status < 300, true, JSON.stringify(confirm.body));
    const after = await call("GET", `/invoices/${inv.id}`, auth);
    assert(after.body.status !== "paid", "a balance is left");

    const emails = toCustomer();
    assertEquals(emails.length, 1, `one receipt email; sent: ${sent()}`);
    assertStringIncludes(emails[0].subject, "Receipt for");
    assert(
      emails[0].attachments?.some((a) => a.contentType === "application/pdf"),
      "the receipt PDF is attached",
    );
    assertEquals(after.body.receiptSentVia, "email");
  });
});
