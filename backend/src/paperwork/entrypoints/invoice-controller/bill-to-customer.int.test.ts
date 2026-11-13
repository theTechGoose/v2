/**
 * REQ-696 — demo-loop cycle 5 (run r37f88707), issues M5 + M22.
 *
 * Pair 9 made INV-002 in Nueva factura with "Sin cliente (agregar después)"
 * and BILL TO "Jorge Ruiz" (REQ-550 accepts a typed bill-to name as the
 * recipient). The invoice was saved with no customerId, so the customers page
 * read "$0 que te deben" while Jorge owed $200, Jorge was never on the list,
 * the invoice list showed "—" and the /invoices hero read "jue: Invoice $200".
 *
 * Over HTTP on the booted app: an invoice issued with only a bill-to name is
 * attached to that customer (created once, re-used by the next invoice), the
 * roster counts what that customer owes, and the forecast labels it by name.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
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

const PORT = 43000 + Math.floor(Math.random() * 2000);
const BASE = `http://localhost:${PORT}`;
const json = { "content-type": "application/json" };

async function login(phone = "+15125550696"): Promise<Record<string, string>> {
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

Deno.test({
  name:
    "REQ-696 M5/M22 (cycle 5): an invoice issued with only a BILL TO name is attached to that customer — the roster counts what they owe and the forecast names them",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () =>
    withServer(async () => {
      const auth = await login();
      // the demo: Nueva factura, "Sin cliente", BILL TO Jorge Ruiz, $200, issued
      const r = await post("/invoices", auth, {
        status: "sent",
        amount: 200_00,
        jobName: "Fence repair",
        dueDate: today(),
        billTo: { name: "Jorge Ruiz" },
      });
      assertEquals(r.status, 200, JSON.stringify(r.body));
      const customerId = r.body.customerId as string | undefined;
      assert(customerId, "the invoice carries the bill-to customer's id");

      const customers = await get<Array<{ id: string; name: string }>>(
        "/customers",
        auth,
      );
      assertEquals(
        customers.map((c) => [c.id, c.name]),
        [[customerId, "Jorge Ruiz"]],
      );

      // the customers page: Jorge is on it, owing $200, and the hero says so
      const page = await get<{
        items: Array<{ id: string; balanceCents: number }>;
        summary: { owedCents: number };
      }>("/clients", auth);
      assertEquals(page.summary.owedCents, 200_00);
      assertEquals(
        page.items.map((c) => [c.id, c.balanceCents]),
        [[customerId, 200_00]],
      );

      // the /invoices hero breakdown names him, never the English "Invoice"
      const fc = await get<{ thisWeek: Array<{ label: string }> }>(
        "/invoices/forecast/this-week",
        auth,
      );
      assertEquals(fc.thisWeek.map((e) => e.label), ["Jorge Ruiz"]);

      // a second bill to the same person is his too — never a duplicate
      const r2 = await post("/invoices", auth, {
        status: "sent",
        amount: 50_00,
        dueDate: today(),
        billTo: { name: "jorge ruiz" },
      });
      assertEquals(r2.status, 200, JSON.stringify(r2.body));
      assertEquals(r2.body.customerId, customerId);
      const after = await get<Array<unknown>>("/customers", auth);
      assertEquals(after.length, 1);
    }),
});
