/**
 * REQ-1016 (LOOP-007 cycle 1, q1-102): "Spanish Paid email is marked
 * <html lang="en">". Every customer email's `<html lang>` is the language it
 * is written in.
 *
 * Over HTTP, the QA5 path: a Spanish-comms business issues an amount-only
 * invoice (no quote behind it), records a payment that closes it — which
 * dispatches the paid email (MarkInvoicePaid) — and the outbox holds that
 * email exactly as sent. Its HtmlBody must open
 * `<!doctype html>\n<html lang="es">`, not `lang="en"`.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AnalyticsModule } from "@analytics/mod-root.ts";
import { CommunicationModule } from "@communication/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [AnalyticsModule, CommunicationModule] })
class TestApp {}

const PORT = 41016;
const BASE = `http://localhost:${PORT}`;

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
  return v.body.sessionId as string;
}

Deno.test('REQ-1016 (LOOP-007 q1, q1-102): the paid email of a Spanish amount-only invoice reaches the outbox as <html lang="es">', async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login("+15125551016");
    await call("PUT", "/me", { name: "Luis Ortega", language: "es" }, sid);
    const id = await call("PUT", "/profile/identity", {
      businessName: "Ortega Handyman Services",
      commsLanguage: "es",
    }, sid);
    assert(id.status < 300, JSON.stringify(id.body));
    const maria = await call("POST", "/customers", {
      name: "María López",
      email: "maria.lopez@gmail.com",
    }, sid);
    assert(maria.status < 300, JSON.stringify(maria.body));
    const inv = await call("POST", "/invoices", {
      customerId: maria.body.id,
      amount: 45_000,
      jobName: "Reparación de cerca",
      status: "sent",
      dueDate: "2026-12-30",
    }, sid);
    assert(inv.status < 300, JSON.stringify(inv.body));
    const pay = await call("POST", "/payments", {
      invoiceId: inv.body.id,
      amount: 45_000,
      method: "zelle",
      receivedAt: "2026-11-18T15:00:00.000Z",
    }, sid);
    assert(pay.status < 300, JSON.stringify(pay.body));

    const list = (await call("GET", "/outbox", undefined, sid)).body as {
      id: string;
      channel: string;
      kind?: string;
      docId?: string;
      preview?: string;
      language?: string;
    }[];
    const paid = list.find((e) =>
      e.channel === "email" && e.docId === inv.body.id &&
      /pagad/i.test(e.preview ?? "")
    );
    assert(paid, `the paid email is in the outbox: ${JSON.stringify(list)}`);
    const opened = (await call("GET", `/outbox/${paid.id}`, undefined, sid))
      .body as { body: string; subject?: string };
    assert(
      opened.body.includes("<title>Factura"),
      "the paid email is written in Spanish",
    );
    assertEquals(
      opened.body.slice(0, opened.body.indexOf(">", 16) + 1),
      '<!doctype html>\n<html lang="es">',
      "the Spanish paid email's root element declares Spanish",
    );
  } finally {
    await server.stop();
    await resetKv();
  }
});

/**
 * REQ-1033 (LOOP-007 cycle 2, q2-16): "Non-shell emails (owner approval, CO
 * receipt, payment receipt) still have bare <html> with no lang". The same
 * Spanish account records a PART payment through POST /payments, which sends
 * the payment receipt (SendPaymentReceipt, REQ-963, built by
 * renderReceiptHtml) — not the paid email. The receipt the outbox holds must
 * open `<!doctype html>\n<html lang="es">` too.
 */
Deno.test('REQ-1033 (LOOP-007 q2, q2-16): the payment receipt of a Spanish part payment reaches the outbox as <html lang="es">', async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login("+15125551033");
    await call("PUT", "/me", { name: "Luis Ortega", language: "es" }, sid);
    const id = await call("PUT", "/profile/identity", {
      businessName: "Ortega Handyman Services",
      commsLanguage: "es",
    }, sid);
    assert(id.status < 300, JSON.stringify(id.body));
    const maria = await call("POST", "/customers", {
      name: "María López",
      email: "maria.lopez@gmail.com",
    }, sid);
    assert(maria.status < 300, JSON.stringify(maria.body));
    const inv = await call("POST", "/invoices", {
      customerId: maria.body.id,
      amount: 45_000,
      jobName: "Reparación de cerca",
      status: "sent",
      dueDate: "2026-12-30",
    }, sid);
    assert(inv.status < 300, JSON.stringify(inv.body));
    const pay = await call("POST", "/payments", {
      invoiceId: inv.body.id,
      amount: 20_000,
      method: "zelle",
      receivedAt: "2026-11-18T15:00:00.000Z",
    }, sid);
    assert(pay.status < 300, JSON.stringify(pay.body));

    const list = (await call("GET", "/outbox", undefined, sid)).body as {
      id: string;
      channel: string;
      kind?: string;
      docId?: string;
      preview?: string;
    }[];
    const receipt = list.find((e) =>
      e.channel === "email" && e.kind === "receipt" &&
      e.docId === inv.body.id
    );
    assert(
      receipt,
      `the receipt email is in the outbox: ${JSON.stringify(list)}`,
    );
    const opened = (await call("GET", `/outbox/${receipt.id}`, undefined, sid))
      .body as { body: string; subject?: string };
    assert(
      /Recibo/.test(opened.subject ?? "") || /Recibo|recibimos/i.test(opened.body),
      `the receipt is written in Spanish: ${opened.subject}`,
    );
    assertEquals(
      opened.body.slice(0, opened.body.indexOf(">", 16) + 1),
      '<!doctype html>\n<html lang="es">',
      "the Spanish payment receipt's root element declares Spanish",
    );
  } finally {
    await server.stop();
    await resetKv();
  }
});
