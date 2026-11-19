/**
 * REQ-941 (LOOP-007 cycle 1, q1-7) — Raphael: "test every single aspect of
 * this application … one Opus agent per issue to do root cause analysis, then
 * one to write the test, then one to fix it and make it green."
 *
 * The bug: the owner records a payment by hand (POST /payments) that closes
 * the balance. ComputeInvoiceBalance → MarkInvoicePaid sends the REQ-020 paid
 * invoice email WITHOUT any attachment, then records receiptSentVia "email".
 * The customer's /i page reads that flag and says "Un recibo en PDF está en
 * tu correo" — a PDF that never went out (demo run r3db0ac6f-4: outbox 003
 * "Pagada — Factura INV-001", "Attachments": []).
 *
 * Integration: the whole app on an in-memory KV through its HTTP routes; only
 * the Postmark send is captured (EmailService.prototype.send).
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AnalyticsModule } from "@analytics/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import {
  EmailService,
  type SendEmailInput,
} from "@communication/domain/data/email-service/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { receivedNoteBody } from "#documents/received-note.ts";
import { receiptSentViaOf } from "#documents/delivery-truth.ts";

@Module({ imports: [AnalyticsModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const BASE = `http://localhost:${PORT}`;
const CUSTOMER_EMAIL = "hans.q17@blackhole.postmarkapp.com";

// deno-lint-ignore no-explicit-any
type Res = { status: number; body: any };
async function call(
  method: string,
  path: string,
  body?: unknown,
  sid?: string,
): Promise<Res> {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(sid ? { "x-session-id": sid } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch { /* raw */ }
  return { status: r.status, body: parsed };
}

async function login(phone: string): Promise<string> {
  await call("POST", "/auth/send-otp", { phoneNumber: phone });
  const stored = await new OtpStore().get(phone);
  const v = await call("POST", "/auth/verify-otp", {
    phoneNumber: phone,
    code: stored!.code,
  });
  const sid = v.body.sessionId as string;
  await call("PUT", "/me", { name: "Rosa Paid", language: "es" }, sid);
  return sid;
}

const ES = JSON.parse(
  await Deno.readTextFile(
    new URL("../../../../../../lang/es.json", import.meta.url),
  ),
) as Record<string, string>;
const tES = (key: string, vars: Record<string, string | number> = {}) =>
  (ES[key] ?? key).replace(
    /\{(\w+)\}/g,
    (_, k) => (k in vars ? String(vars[k]) : `{${k}}`),
  );

Deno.test("REQ-941 (LOOP-007 q1-7): a hand-recorded payment that closes the invoice emails the customer a PDF receipt, matching what /i promises", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const sent: SendEmailInput[] = [];
  const realSend = EmailService.prototype.send;
  EmailService.prototype.send = function (input: SendEmailInput) {
    sent.push(input);
    return Promise.resolve({ ok: true, messageId: `m-${sent.length}` });
  };
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login("+15555559417");
    const customer = await call("POST", "/customers", {
      name: "Hans Hansen",
      email: CUSTOMER_EMAIL,
      language: "es", // the declared key — REQ-1119 refuses undeclared ones
    }, sid);
    assert(customer.status < 300, JSON.stringify(customer.body));
    const inv = await call("POST", "/invoices", {
      customerId: customer.body.id,
      amount: 125000,
      dueDate: "2026-12-01",
      issuedDate: "2026-11-06",
      jobName: "Deck rebuild",
      status: "sent",
    }, sid);
    assert(inv.status < 300, JSON.stringify(inv.body));
    const before = sent.length;

    // the customer page's "Registrar pago" → Cheque → the full amount
    const pay = await call("POST", "/payments", {
      invoiceId: inv.body.id,
      amount: 125000,
      method: "check",
      receivedAt: "2026-11-17T15:00:00.000Z",
    }, sid);
    assert(pay.status < 300, JSON.stringify(pay.body));

    const pub = (await call("GET", `/invoices/${inv.body.id}/public`)).body;
    assertEquals(pub.status, "paid");

    const toCustomer = sent.slice(before).filter((e) =>
      e.to === CUSTOMER_EMAIL
    );
    assert(
      toCustomer.length > 0,
      `closing the invoice emails the customer (sent: ${
        JSON.stringify(sent.slice(before).map((e) => e.subject))
      })`,
    );
    const pdfs = toCustomer.flatMap((e) => e.attachments ?? []).filter((a) =>
      a.contentType === "application/pdf" && a.content.byteLength > 0
    );

    // What the customer's /i?lang=es reads from that public record
    const note = receivedNoteBody(tES, "es", {
      paidAt: pub.paidAt,
      who: "Rosa",
      channel: receiptSentViaOf(pub.receiptSentVia),
    });

    // The page's promise and the mail must agree…
    assertEquals(
      { promisesPdf: /PDF/.test(note), pdfAttached: pdfs.length > 0 },
      { promisesPdf: pdfs.length > 0, pdfAttached: pdfs.length > 0 },
      `/i says "${note}" (receiptSentVia ${pub.receiptSentVia}), the customer's emails carried ${pdfs.length} PDF(s): ${
        JSON.stringify(
          toCustomer.map((e) => ({
            subject: e.subject,
            attachments: (e.attachments ?? []).map((a) => a.name),
          })),
        )
      }`,
    );
    // …and the promise is kept: exactly one receipt PDF reached the customer.
    assertEquals(
      pdfs.length,
      1,
      "the paid invoice email carries one PDF receipt",
    );
    assertEquals(pub.receiptSentVia, "email");
  } finally {
    EmailService.prototype.send = realSend;
    await server.stop();
    await resetKv();
  }
});
