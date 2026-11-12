/**
 * REQ-551 (demo-loop cycle 4, issue B2) over HTTP on the booted app. The demo
 * recorded a $999,999,999 payment on a $99,999,999 invoice with no check, and
 * the Customers leaderboard then said there were no paid invoices because the
 * invoice had no customer.
 *
 *  - POST /payments above the balance is a 409 `overpayment` (nothing stored,
 *    the invoice stays open) unless the request says `override: true`
 *  - above 10x the invoice it is a 422 `overpayment_limit`, override or not
 *  - GET /analytics/clients/top reports the paid invoices it cannot rank
 *    (no customer) as `unassigned`
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { CrmModule } from "@crm/mod-root.ts";
import { AnalyticsModule } from "@analytics/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, CrmModule, PaperworkModule, AnalyticsModule] })
class TestApp {}

const PORT = 9551;
const BASE = `http://localhost:${PORT}`;
const json = { "content-type": "application/json" };
const DEMO_INVOICE = 9_999_999_900; // $99,999,999.00
const DEMO_PAYMENT = 99_999_999_900; // $999,999,999.00

async function login(phone = "+15125550551"): Promise<Record<string, string>> {
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
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    await fn();
  } finally {
    await server.stop();
    await resetKv();
  }
}

async function sentInvoice(auth: Record<string, string>, amount: number) {
  const inv = await call("POST", "/invoices", auth, {
    jobName: "Test job",
    amount,
    status: "sent",
    dueDate: "2026-12-01",
    // REQ-550: an issued invoice needs a customer or a bill-to name
    billTo: { name: "Pat Doe" },
  });
  assertEquals(inv.status < 400, true, JSON.stringify(inv.body));
  return inv.body as { id: string };
}

const today = () => new Date().toISOString();

Deno.test("REQ-551 B2: a payment above the balance is a 409 overpayment — nothing stored, the invoice stays open", async () => {
  await withServer(async () => {
    const auth = await login();
    const inv = await sentInvoice(auth, 6500);
    const r = await call("POST", "/payments", auth, {
      invoiceId: inv.id,
      amount: 10000,
      method: "zelle",
      receivedAt: today(),
    });
    assertEquals(r.status, 409, JSON.stringify(r.body));
    assertEquals(r.body.error, "overpayment");
    assertEquals(r.body.balanceCents, 6500);
    assertEquals(r.body.overCents, 3500);
    const rows = await call("GET", `/payments?invoiceId=${inv.id}`, auth);
    assertEquals(rows.body.length, 0);
    const after = await call("GET", `/invoices/${inv.id}`, auth);
    assertEquals(after.body.status !== "paid", true);
  });
});

Deno.test("REQ-551 B2: with override:true the overpayment is recorded and flagged (REQ-202)", async () => {
  await withServer(async () => {
    const auth = await login();
    const inv = await sentInvoice(auth, 6500);
    const r = await call("POST", "/payments", auth, {
      invoiceId: inv.id,
      amount: 10000,
      method: "zelle",
      receivedAt: today(),
      override: true,
    });
    assertEquals(r.status < 400, true, JSON.stringify(r.body));
    assertEquals(r.body.amount, 10000);
    assertEquals("override" in r.body, false, "the flag is never stored");
    const after = await call("GET", `/invoices/${inv.id}`, auth);
    assertEquals(after.body.status, "paid");
    assertEquals(after.body.overpaidCents, 3500);
  });
});

Deno.test("REQ-551 B2: the demo's $999,999,999 on a $99,999,999 invoice is refused even with override (over 10x)", async () => {
  await withServer(async () => {
    const auth = await login();
    const inv = await sentInvoice(auth, DEMO_INVOICE);
    for (const override of [false, true]) {
      const r = await call("POST", "/payments", auth, {
        invoiceId: inv.id,
        amount: DEMO_PAYMENT,
        method: "card",
        receivedAt: today(),
        override,
      });
      assertEquals(r.status, 422, JSON.stringify(r.body));
      assertEquals(r.body.error, "overpayment_limit");
      assertEquals(r.body.limitCents, DEMO_INVOICE * 10);
    }
    const rows = await call("GET", `/payments?invoiceId=${inv.id}`, auth);
    assertEquals(rows.body.length, 0);
  });
});

Deno.test("REQ-551 B2: a payment up to the balance still records with no flag (partial, then exact)", async () => {
  await withServer(async () => {
    const auth = await login();
    const inv = await sentInvoice(auth, 6500);
    const a = await call("POST", "/payments", auth, {
      invoiceId: inv.id,
      amount: 2000,
      method: "cash",
      receivedAt: today(),
    });
    assertEquals(a.status < 400, true, JSON.stringify(a.body));
    const b = await call("POST", "/payments", auth, {
      invoiceId: inv.id,
      amount: 4500,
      method: "cash",
      receivedAt: today(),
    });
    assertEquals(b.status < 400, true, JSON.stringify(b.body));
    const after = await call("GET", `/invoices/${inv.id}`, auth);
    assertEquals(after.body.status, "paid");
    assertEquals(after.body.overpaidCents, undefined);
  });
});

Deno.test("REQ-551 B2: the leaderboard reports paid invoices with no customer as unassigned, instead of hiding them", async () => {
  await withServer(async () => {
    const auth = await login();
    const inv = await sentInvoice(auth, 50000);
    const pay = await call("POST", "/payments", auth, {
      invoiceId: inv.id,
      amount: 50000,
      method: "check",
      receivedAt: today(),
    });
    assertEquals(pay.status < 400, true, JSON.stringify(pay.body));
    const top = await call("GET", "/analytics/clients/top", auth);
    assertEquals(top.status, 200, JSON.stringify(top.body));
    assertEquals(top.body.results, []);
    assertEquals(top.body.unassigned, {
      invoiceCount: 1,
      revenue12moCents: 50000,
    });
  });
});
