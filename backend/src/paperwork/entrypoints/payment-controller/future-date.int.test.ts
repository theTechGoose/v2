/**
 * REQ-943 — LOOP-007 cycle 1, issue q1-8, over HTTP on the booted app. QA
 * recorded a payment "Recibido el" 2027-06-01 while today was 2026-11-19: POST
 * /payments stored it as-is (`receivedAt` is only @IsString), the invoice
 * closed with paidAt 2027-06-01 and the customer was emailed "PAGADA 1 de
 * junio de 2027". /payments then counted it as "Hoy" and this month (q1-9).
 *
 *  - POST /payments with a receivedAt after today is a 422 `future_date`:
 *    no Payment row, the invoice stays open, no PAID email in the outbox
 *  - a PUT can't move a recorded payment into the future either
 *  - an unparseable receivedAt is refused too
 *  - today (the control) still records and closes the invoice
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { CrmModule } from "@crm/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { OutboxStore } from "@communication/domain/data/outbox-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, CrmModule, PaperworkModule] })
class TestApp {}

const PORT = 9943;
const BASE = `http://localhost:${PORT}`;
const json = { "content-type": "application/json" };

async function login(phone = "+15125550943"): Promise<Record<string, string>> {
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
  // the PAID email needs a sender name, so the outbox check below is real
  await (await fetch(`${BASE}/me`, {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({
      name: "Luis Future",
      businessName: "Future Fences",
    }),
  })).body?.cancel();
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

/** a sent $1,250 invoice to a customer with an email, issued today */
async function sentInvoice(auth: Record<string, string>) {
  const customer = await call("POST", "/customers", auth, {
    name: "Randall Belknap",
    email: "rb@blackhole.postmarkapp.com",
  });
  assertEquals(customer.status < 400, true, JSON.stringify(customer.body));
  const inv = await call("POST", "/invoices", auth, {
    customerId: customer.body.id,
    jobName: "Back fence",
    amount: 125000,
    status: "sent",
    issuedDate: new Date().toISOString().slice(0, 10),
    dueDate: "2026-12-31",
  });
  assertEquals(inv.status < 400, true, JSON.stringify(inv.body));
  return inv.body as { id: string; userId: string };
}

const inDays = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString();

function isFutureDateRefusal(
  r: { status: number; body: Record<string, unknown> },
) {
  return r.status === 422 &&
    (r.body.error === "future_date" || r.body.reason === "future_date");
}

Deno.test("REQ-943 (q1-8): POST /payments dated after today is a 422 future_date — nothing stored, the invoice stays open, no PAID email", async () => {
  await withServer(async () => {
    const auth = await login();
    const inv = await sentInvoice(auth);
    for (const receivedAt of ["2027-06-01T12:00:00Z", inDays(200)]) {
      const r = await call("POST", "/payments", auth, {
        invoiceId: inv.id,
        amount: 125000,
        method: "zelle",
        receivedAt,
      });
      assert(
        isFutureDateRefusal(r),
        `receivedAt=${receivedAt} → ${r.status} ${JSON.stringify(r.body)}`,
      );
    }
    const rows = await call("GET", `/payments?invoiceId=${inv.id}`, auth);
    assertEquals(rows.body.length, 0, "no Payment row");
    const after = await call("GET", `/invoices/${inv.id}`, auth);
    assertEquals(after.body.status !== "paid", true, "the invoice stays open");
    assertEquals(after.body.paidAt ?? null, null, "no paidAt");
    const sent = await new OutboxStore().listByUser(inv.userId);
    assertEquals(
      sent.filter((e) => /paid|pagad/i.test(JSON.stringify(e))).length,
      0,
      `no PAID message to the customer (${JSON.stringify(sent)})`,
    );
  });
});

Deno.test("REQ-943 (q1-8): an unparseable receivedAt is refused, not stored", async () => {
  await withServer(async () => {
    const auth = await login();
    const inv = await sentInvoice(auth);
    const r = await call("POST", "/payments", auth, {
      invoiceId: inv.id,
      amount: 125000,
      method: "cash",
      receivedAt: "not a date",
    });
    assert(
      r.status >= 400 && r.status < 500,
      `${r.status} ${JSON.stringify(r.body)}`,
    );
    const rows = await call("GET", `/payments?invoiceId=${inv.id}`, auth);
    assertEquals(rows.body.length, 0, "no Payment row");
  });
});

Deno.test("REQ-943 (q1-8): a PUT can't move a recorded payment into the future", async () => {
  await withServer(async () => {
    const auth = await login();
    const inv = await sentInvoice(auth);
    const ok = await call("POST", "/payments", auth, {
      invoiceId: inv.id,
      amount: 50000,
      method: "cash",
      receivedAt: new Date().toISOString(),
    });
    assertEquals(ok.status < 400, true, JSON.stringify(ok.body));
    const put = await call("PUT", `/payments/${ok.body.id}`, auth, {
      receivedAt: "2027-06-01T12:00:00Z",
    });
    assert(
      isFutureDateRefusal(put),
      `${put.status} ${JSON.stringify(put.body)}`,
    );
    const row = await call("GET", `/payments/${ok.body.id}`, auth);
    assertEquals(
      row.body.receivedAt,
      ok.body.receivedAt,
      "the date is unchanged",
    );
  });
});

Deno.test("REQ-943 (q1-8): control — a payment received today still records and closes the invoice", async () => {
  await withServer(async () => {
    const auth = await login();
    const inv = await sentInvoice(auth);
    const r = await call("POST", "/payments", auth, {
      invoiceId: inv.id,
      amount: 125000,
      method: "zelle",
      receivedAt: new Date().toISOString(),
    });
    assertEquals(r.status < 400, true, JSON.stringify(r.body));
    const after = await call("GET", `/invoices/${inv.id}`, auth);
    assertEquals(after.body.status, "paid");
    // the outbox check in the first test is live: today's payment sends it
    const sent = await new OutboxStore().listByUser(inv.userId);
    assert(
      sent.some((e) => /paid|pagad/i.test(JSON.stringify(e))),
      `the PAID message is in the outbox (${JSON.stringify(sent)})`,
    );
  });
});
