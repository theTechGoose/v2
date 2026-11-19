/**
 * REQ-1119 (LOOP-007 cycle 3, q3-45 / q3-46 / q3-47) — POST/PUT /invoices
 * refuse a Bill-to phone the one phone rule (REQ-1080, customerPhoneE164)
 * cannot parse, with the same 400 customer.invalidPhone /customers answers.
 *
 * Today the invoice is saved with billTo.phoneNumber "843-555-0145 x12": the
 * public /i shows the raw string (q3-46), the bill-to customer is created
 * WITHOUT the phone (bill-to-customer quietly drops it), so the customer page
 * reads "Phone —" while the invoice carries one (q3-47), and the text fails
 * at send time with "invalid phone: …" (q3-45).
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { CrmModule } from "@crm/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { AnalyticsModule } from "@analytics/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({
  imports: [UsersModule, CrmModule, PaperworkModule, AnalyticsModule],
})
class TestApp {}

const PORT = 45000 + Math.floor(Math.random() * 2000);
const BASE = `http://localhost:${PORT}`;
const json = { "content-type": "application/json" };

async function login(phone = "+15125551119"): Promise<Record<string, string>> {
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

async function send(
  method: string,
  path: string,
  headers: Record<string, string>,
  body: unknown,
) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text);
  } catch { /* not json */ }
  return { status: r.status, text, body: parsed };
}

async function get<T>(path: string, headers: Record<string, string>) {
  return await fetch(`${BASE}${path}`, { headers }).then((r) => r.json()) as T;
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

const today = () => new Date().toISOString().slice(0, 10);

for (const phoneNumber of ["843-555-0145 x12", "(843) 555-2345 ext 4"]) {
  Deno.test({
    name:
      `REQ-1119 q3-45/q3-46 POST /invoices with billTo.phoneNumber '${phoneNumber}' answers 400 customer.invalidPhone — no invoice, no customer`,
    sanitizeOps: false,
    sanitizeResources: false,
    fn: () =>
      withServer(async () => {
        const auth = await login();
        const r = await send("POST", "/invoices", auth, {
          status: "sent",
          amount: 300_00,
          jobName: "Gutter repair",
          dueDate: today(),
          billTo: { name: "Greg", phoneNumber, email: "greg@example.com" },
        });
        const stored = await get<Array<{ billTo?: { phoneNumber?: string } }>>(
          "/invoices",
          auth,
        );
        const customers = await get<Array<{ name: string }>>(
          "/customers",
          auth,
        );
        assertEquals(
          r.status,
          400,
          `answered ${r.status}; stored billTo ${
            JSON.stringify(stored.map((i) => i.billTo))
          }; customers ${JSON.stringify(customers)}`,
        );
        assertEquals(r.text.includes("customer.invalidPhone"), true, r.text);
        assertEquals(stored.length, 0, "no invoice is stored");
        assertEquals(customers.length, 0, "no bill-to customer is created");
      }),
  });
}

Deno.test({
  name:
    "REQ-1119 q3-45 PUT /invoices/:id with billTo.phoneNumber '843-555-0145 x12' answers 400 customer.invalidPhone and keeps the stored bill-to",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () =>
    withServer(async () => {
      const auth = await login();
      const created = await send("POST", "/invoices", auth, {
        status: "draft",
        amount: 300_00,
        dueDate: today(),
        billTo: { name: "Greg", phoneNumber: "(843) 555-2345" },
      });
      assertEquals(created.status, 200, created.text);
      const id = created.body.id as string;
      const r = await send("PUT", `/invoices/${id}`, auth, {
        billTo: { name: "Greg", phoneNumber: "843-555-0145 x12" },
      });
      const after = await get<{ billTo?: { phoneNumber?: string } }>(
        `/invoices/${id}`,
        auth,
      );
      assertEquals(
        r.status,
        400,
        `answered ${r.status}; stored billTo ${JSON.stringify(after.billTo)}`,
      );
      assertEquals(r.text.includes("customer.invalidPhone"), true, r.text);
      assertEquals(after.billTo?.phoneNumber, "(843) 555-2345");
    }),
});

Deno.test({
  name:
    "REQ-1119 q3-47 POST /invoices with a valid billTo phone: the bill-to customer carries that phone (the customer page never reads 'Phone —')",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () =>
    withServer(async () => {
      const auth = await login();
      const r = await send("POST", "/invoices", auth, {
        status: "sent",
        amount: 300_00,
        dueDate: today(),
        billTo: { name: "Greg", phoneNumber: "(843) 555-2345" },
      });
      assertEquals(r.status, 200, r.text);
      const c = await get<{ phoneNumber?: string }>(
        `/customers/${r.body.customerId}`,
        auth,
      );
      assertEquals(c.phoneNumber, "(843) 555-2345");
    }),
});
