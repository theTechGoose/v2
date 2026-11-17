/**
 * REQ-550 — demo-loop cycle 4 (run r857a9d67), issue B1: a $99,999,999
 * invoice with no customer and no recipient was issued and stamped Sent.
 * POST /invoices took it — customerId optional, `amount` a bare @IsNumber,
 * sentAt stamped for any non-draft status.
 *
 * Over HTTP on the booted app: an issued status with no customer (direct or
 * from the quote) and no bill-to name is a 422 `invoice_needs_recipient`;
 * an amount past the $1bn cap (assistant-draft's MAX_CENTS) is a 422; a
 * draft needs neither; a bill-to name alone is a recipient.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { CrmModule } from "@crm/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, CrmModule, PaperworkModule] })
class TestApp {}

const PORT = 41000 + Math.floor(Math.random() * 2000);
const BASE = `http://localhost:${PORT}`;
const json = { "content-type": "application/json" };

async function login(phone = "+15125550550"): Promise<Record<string, string>> {
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

async function post(
  path: string,
  headers: Record<string, string>,
  body: unknown,
) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

async function listInvoices(auth: Record<string, string>) {
  return await fetch(`${BASE}/invoices`, { headers: auth }).then((r) =>
    r.json()
  ) as Array<Record<string, unknown>>;
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

Deno.test({
  name:
    "REQ-550 B1 (cycle 4): POST /invoices refuses an issued invoice with no customer and no bill-to name (422), saves nothing, and stamps no sentAt",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () =>
    withServer(async () => {
      const auth = await login();
      // the demo: no customer, no recipient, $99,999,999, issued
      const r = await post("/invoices", auth, {
        status: "sent",
        amount: 99_999_999_00,
        jobName: "Big job",
        dueDate: "2026-12-30",
      });
      assertEquals(r.status, 422, JSON.stringify(r.body));
      assertEquals(r.body.error, "invoice_needs_recipient");
      // a blank bill-to name is no recipient either
      const blank = await post("/invoices", auth, {
        status: "sent",
        amount: 500_00,
        billTo: { name: "   " },
      });
      assertEquals(blank.status, 422, JSON.stringify(blank.body));
      assertEquals((await listInvoices(auth)).length, 0, "nothing was saved");
    }),
});

Deno.test({
  name:
    "REQ-550 B1 (cycle 4): a draft needs no recipient; a bill-to name or a customer is enough to issue",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () =>
    withServer(async () => {
      const auth = await login();
      const draft = await post("/invoices", auth, {
        status: "draft",
        amount: 500_00,
      });
      assert(draft.status < 300, JSON.stringify(draft.body));
      assertEquals(draft.body.status, "draft");
      assertEquals(draft.body.sentAt, undefined);

      const walkIn = await post("/invoices", auth, {
        status: "sent",
        amount: 500_00,
        billTo: { name: "Walk-in customer" },
      });
      assert(walkIn.status < 300, JSON.stringify(walkIn.body));
      assertEquals(walkIn.body.status, "sent");

      const customer = await post("/customers", auth, { name: "Ana Ruiz" });
      const toClient = await post("/invoices", auth, {
        status: "sent",
        amount: 500_00,
        customerId: customer.body.id,
      });
      assert(toClient.status < 300, JSON.stringify(toClient.body));
      assertEquals(toClient.body.status, "sent");
    }),
});

Deno.test({
  name:
    "REQ-550 B1 (cycle 4): POST /invoices refuses an amount past the $1bn cap with a 422, draft or issued",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () =>
    withServer(async () => {
      const auth = await login();
      for (const status of ["draft", "sent"]) {
        const r = await post("/invoices", auth, {
          status,
          amount: 100_000_000_000 + 1,
          billTo: { name: "Ana Ruiz" },
        });
        assertEquals(r.status, 422, `${status}: ${JSON.stringify(r.body)}`);
        assertEquals(r.body.error, "invalid_invoice");
      }
      const atCap = await post("/invoices", auth, {
        status: "draft",
        amount: 100_000_000_000,
        billTo: { name: "Ana Ruiz" },
      });
      assert(atCap.status < 300, JSON.stringify(atCap.body));
      assertEquals((await listInvoices(auth)).length, 1);
    }),
});
