/**
 * REQ-1110 (LOOP-007 cycle 3, issue q3-34) over HTTP on the booted app. QA
 * recorded a $400.25 check on INV-002 ($1,000.50) with POST /payments. The
 * receipt email said "payment of $400.25 … Balance still due: $600.25 of
 * $1,000.50", but the PDF attached to it said "AMOUNT RECEIVED $1,000.50".
 *
 *  - the part-payment receipt's PDF shows the $400.25 received and the
 *    $600.25 balance, never the $1,000.50 total as the amount received
 *  - the payment that closes the bill ($600.25) attaches a receipt PDF that
 *    shows the $600.25 received, not the $1,000.50 total
 *
 * Only the email provider is captured (EmailService.send); everything else
 * is the real app on an in-memory KV.
 */
import "#reflect-metadata";
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { decodePDFRawStream, PDFDocument, PDFRawStream } from "#pdf-lib";
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

const PORT = 9734;
const BASE = `http://localhost:${PORT}`;
const json = { "content-type": "application/json" };
const OWNER_EMAIL = "whitfield.owner@test.dev";
const CUSTOMER_EMAIL = "greg.customer@test.dev";

const mails: SendEmailInput[] = [];
EmailService.prototype.send = function (input: SendEmailInput) {
  mails.push(input);
  return Promise.resolve({ ok: true, messageId: `pm-${mails.length}` });
};
const toCustomer = () => mails.filter((m) => m.to === CUSTOMER_EMAIL);

/** every string the PDF draws, one per line, in drawing order */
async function drawnText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  let out = "";
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    let s: string;
    try {
      s = new TextDecoder("latin1").decode(decodePDFRawStream(obj).decode());
    } catch {
      continue;
    }
    for (const m of s.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
      let line = "";
      for (let i = 0; i + 1 < m[1].length; i += 2) {
        line += String.fromCharCode(parseInt(m[1].slice(i, i + 2), 16));
      }
      out += line + "\n";
    }
    for (const m of s.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)) {
      out += m[1] + "\n";
    }
  }
  return out;
}

/** the line the receipt draws right after "AMOUNT RECEIVED" */
function amountReceived(text: string): string | undefined {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => /AMOUNT RECEIVED/i.test(l));
  return i < 0 ? undefined : lines[i + 1];
}

/** the receipt PDF attached to a captured email (name says Receipt) */
async function receiptPdfText(mail: SendEmailInput): Promise<string> {
  const pdf = mail.attachments?.find((a) =>
    a.contentType === "application/pdf" && /receipt|recibo/i.test(a.name)
  );
  assert(
    pdf,
    `a receipt PDF is attached; attachments: ${
      JSON.stringify(mail.attachments?.map((a) => a.name))
    }`,
  );
  return await drawnText(pdf.content);
}

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
  const auth = { ...json, "x-session-id": v.sessionId };
  const users = new UserStore();
  const me = await users.findByPhone(phone);
  await users.update(me!.id, {
    name: "Whitfield Fence & Deck",
    email: OWNER_EMAIL,
  });
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

/** a sent $1,000.50 invoice to Greg, who has an email on file */
async function sentInvoice(auth: Record<string, string>) {
  const customer = await call("POST", "/customers", auth, {
    name: "Greg Pruitt",
    email: CUSTOMER_EMAIL,
  });
  assertEquals(customer.status < 400, true, JSON.stringify(customer.body));
  const inv = await call("POST", "/invoices", auth, {
    customerId: customer.body.id,
    jobName: "Fence repair",
    amount: 100050,
    status: "sent",
    dueDate: "2026-12-01",
  });
  assertEquals(inv.status < 400, true, JSON.stringify(inv.body));
  return inv.body as { id: string };
}

const today = () => new Date().toISOString();

Deno.test("REQ-1110 (LOOP-007 q3, q3-34): a $400.25 check on a $1,000.50 invoice (POST /payments) emails a receipt whose PDF reads AMOUNT RECEIVED $400.25 and the $600.25 balance, never $1,000.50 received", async () => {
  await withServer(async () => {
    const auth = await login("+15125551110");
    const inv = await sentInvoice(auth);
    mails.length = 0;

    const pay = await call("POST", "/payments", auth, {
      invoiceId: inv.id,
      amount: 40025,
      method: "check",
      reference: "Check #1042",
      receivedAt: today(),
    });
    assertEquals(pay.status < 400, true, JSON.stringify(pay.body));

    const receipts = toCustomer();
    assertEquals(receipts.length, 1, "one receipt email to the customer");
    // the email body is already right (REQ-1071); the PDF must agree with it
    assertStringIncludes(receipts[0].htmlBody ?? "", "$400.25");
    const text = await receiptPdfText(receipts[0]);
    assertEquals(
      amountReceived(text),
      "$400.25",
      `the PDF's amount received is the $400.25 paid; drawn text:\n${text}`,
    );
    assertStringIncludes(
      text,
      "$600.25",
      "the PDF shows the balance still due",
    );
  });
});

Deno.test("REQ-1110 (LOOP-007 q3, q3-34): the $600.25 payment that closes a $1,000.50 bill attaches a receipt PDF reading AMOUNT RECEIVED $600.25, not the $1,000.50 total", async () => {
  await withServer(async () => {
    const auth = await login("+15125552110");
    const inv = await sentInvoice(auth);
    const first = await call("POST", "/payments", auth, {
      invoiceId: inv.id,
      amount: 40025,
      method: "check",
      receivedAt: today(),
    });
    assertEquals(first.status < 400, true, JSON.stringify(first.body));
    mails.length = 0;

    const rest = await call("POST", "/payments", auth, {
      invoiceId: inv.id,
      amount: 60025,
      method: "zelle",
      reference: "ZL-77812",
      receivedAt: today(),
    });
    assertEquals(rest.status < 400, true, JSON.stringify(rest.body));
    const after = await call("GET", `/invoices/${inv.id}`, auth);
    assertEquals(after.body.status, "paid");

    const sent = toCustomer();
    assertEquals(sent.length, 1, "one customer email on the closing payment");
    const text = await receiptPdfText(sent[0]);
    assertEquals(
      amountReceived(text),
      "$600.25",
      `the closing receipt's amount received is the $600.25 paid; drawn text:\n${text}`,
    );
  });
});
