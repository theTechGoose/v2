/**
 * REQ-963 (LOOP-007 cycle 1, issue q1-37) over HTTP on the booted app. QA
 * recorded a $400 check on a $1,000 invoice in the Record payment dialog
 * (POST /payments). The page said "Payment of $400.00 recorded" and the
 * customer got nothing — no receipt email, nothing in the outbox. The same
 * payment told to the assistant goes through ConfirmPayment and is receipted.
 *
 *  - a part payment recorded by hand emails the customer one receipt
 *    ("Receipt for INV-…", the receipt PDF attached, the contractor cc'd),
 *    lists it in the outbox (kind "receipt") and stamps receiptSentVia
 *  - the payment that closes the balance still sends exactly ONE customer
 *    email (the PAID invoice, REQ-020) — never a receipt on top of it
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
import { resetKv } from "@core/data/kv/mod.ts";
import {
  EmailService,
  type SendEmailInput,
} from "@communication/domain/data/email-service/mod.ts";

@Module({
  imports: [UsersModule, CrmModule, CommunicationModule, PaperworkModule],
})
class TestApp {}

const PORT = 9963;
const BASE = `http://localhost:${PORT}`;
const json = { "content-type": "application/json" };
const OWNER_EMAIL = "luis.owner@test.dev";
const CUSTOMER_EMAIL = "pat.customer@test.dev";

// the provider, captured: every email the app hands to Postmark
const mails: SendEmailInput[] = [];
EmailService.prototype.send = function (input: SendEmailInput) {
  mails.push(input);
  return Promise.resolve({ ok: true, messageId: `pm-${mails.length}` });
};
const toCustomer = () => mails.filter((m) => m.to === CUSTOMER_EMAIL);

async function login(phone = "+15125550963"): Promise<Record<string, string>> {
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
  const auth = { ...json, "x-session-id": v.sessionId };
  const users = new UserStore();
  const me = await users.findByPhone(phone);
  await users.update(me!.id, { name: "Luis Ortega", email: OWNER_EMAIL });
  return auth;
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

/** a sent $1,000 invoice to Pat, who has an email on file */
async function sentInvoice(auth: Record<string, string>) {
  const customer = await call("POST", "/customers", auth, {
    name: "Pat Doe",
    email: CUSTOMER_EMAIL,
  });
  assertEquals(customer.status < 400, true, JSON.stringify(customer.body));
  const inv = await call("POST", "/invoices", auth, {
    customerId: customer.body.id,
    jobName: "Kitchen repaint",
    amount: 100000,
    status: "sent",
    dueDate: "2026-12-01",
  });
  assertEquals(inv.status < 400, true, JSON.stringify(inv.body));
  return inv.body as { id: string; number?: string };
}

const today = () => new Date().toISOString();

Deno.test("REQ-963 q1-37: a $400 part payment on a $1,000 invoice, recorded by hand, emails the customer a receipt (PDF attached, contractor cc'd), lists it in the outbox and stamps receiptSentVia", async () => {
  await withServer(async () => {
    const auth = await login();
    const inv = await sentInvoice(auth);
    mails.length = 0; // only what the payment sends

    const pay = await call("POST", "/payments", auth, {
      invoiceId: inv.id,
      amount: 40000,
      method: "check",
      receivedAt: today(),
    });
    assertEquals(pay.status < 400, true, JSON.stringify(pay.body));
    const after = await call("GET", `/invoices/${inv.id}`, auth);
    assertEquals(after.body.status !== "paid", true, "a balance is left");

    const receipts = toCustomer();
    assertEquals(
      receipts.length,
      1,
      `one receipt email to the customer; sent: ${
        JSON.stringify(mails.map((m) => ({ to: m.to, subject: m.subject })))
      }`,
    );
    const receipt = receipts[0];
    assertStringIncludes(receipt.subject, "Receipt for");
    assertEquals(receipt.cc, [OWNER_EMAIL], "the contractor is cc'd");
    assert(
      receipt.attachments?.some((a) => a.contentType === "application/pdf"),
      "the receipt PDF is attached",
    );
    assertEquals(after.body.receiptSentVia, "email");

    const outbox = await call("GET", "/outbox", auth);
    assertEquals(outbox.status, 200, JSON.stringify(outbox.body));
    const rows = (outbox.body as { kind: string; channel: string }[])
      .filter((r) => r.kind === "receipt" && r.channel === "email");
    assertEquals(rows.length, 1, "the receipt is in the outbox");
  });
});

Deno.test("REQ-963 q1-37: the payment that closes the balance sends exactly one customer email — the PAID invoice, not a receipt on top", async () => {
  await withServer(async () => {
    const auth = await login();
    const inv = await sentInvoice(auth);
    const first = await call("POST", "/payments", auth, {
      invoiceId: inv.id,
      amount: 40000,
      method: "check",
      receivedAt: today(),
    });
    assertEquals(first.status < 400, true, JSON.stringify(first.body));
    mails.length = 0;

    const rest = await call("POST", "/payments", auth, {
      invoiceId: inv.id,
      amount: 60000,
      method: "check",
      receivedAt: today(),
    });
    assertEquals(rest.status < 400, true, JSON.stringify(rest.body));
    const after = await call("GET", `/invoices/${inv.id}`, auth);
    assertEquals(after.body.status, "paid");
    assertEquals(
      toCustomer().length,
      1,
      `exactly one customer email on the closing payment; sent: ${
        JSON.stringify(mails.map((m) => ({ to: m.to, subject: m.subject })))
      }`,
    );
  });
});

/**
 * REQ-1071 (LOOP-007 cycle 2, q2-60): QA paid $500 of a $1,190.75 invoice and
 * the receipt read "We've recorded your payment of $500…" — no cents, no
 * balance still due, no link back to the invoice to pay it.
 */
Deno.test("REQ-1071 q2-60: a $500 part payment on a $1,190.75 invoice emails a receipt with $500.00, the $690.75 balance and a link to pay it", async () => {
  await withServer(async () => {
    const auth = await login("+15125551071");
    const customer = await call("POST", "/customers", auth, {
      name: "Pat Doe",
      email: CUSTOMER_EMAIL,
    });
    assertEquals(customer.status < 400, true, JSON.stringify(customer.body));
    const inv = await call("POST", "/invoices", auth, {
      customerId: customer.body.id,
      jobName: "Kitchen repaint",
      amount: 119075,
      status: "sent",
      dueDate: "2026-12-01",
    });
    assertEquals(inv.status < 400, true, JSON.stringify(inv.body));
    mails.length = 0;

    const pay = await call("POST", "/payments", auth, {
      invoiceId: inv.body.id,
      amount: 50000,
      method: "check",
      receivedAt: today(),
    });
    assertEquals(pay.status < 400, true, JSON.stringify(pay.body));

    const receipts = toCustomer();
    assertEquals(receipts.length, 1, "one receipt email to the customer");
    const html = receipts[0].htmlBody ?? "";
    assertStringIncludes(html, "$500.00", "the payment with cents");
    assertStringIncludes(html, "$690.75", "the balance still due");
    assert(
      /href="[^"]*\/(s|i)\/[^"]+"/.test(html),
      `a link back to the invoice (/s/… or /i/…) to pay the balance; got:\n${html}`,
    );
  });
});
