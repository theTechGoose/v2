import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AnalyticsModule } from "@analytics/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [AnalyticsModule] })
class TestApp {}

const PORT = 9090;

async function drain(res: Response) { await res.body?.cancel(); }

async function login(port: number, phone = "+15125551234"): Promise<string> {
  await drain(await fetch(`http://localhost:${port}/auth/send-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone }),
  }));
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`http://localhost:${port}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

Deno.test("analytics e2e: GET /analytics/dashboard returns zero-state for fresh user", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const stats = await fetch(`http://localhost:${PORT}/analytics/dashboard`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(stats.customers, 0);
    assertEquals(stats.quotes.sent, 0);
    assertEquals(stats.invoices.overdue, 0);
    assertEquals(stats.revenue.sparkline12mo.length, 12);
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("analytics e2e: GET /analytics/dashboard rolls up after creating quotes + invoices", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const auth = { "content-type": "application/json", "x-session-id": sid };

    await drain(await fetch(`http://localhost:${PORT}/customers`, {
      method: "POST", headers: auth, body: JSON.stringify({ name: "Acme" }),
    }));
    // Audit1 #3 — money fields are INTEGER CENTS (`_00` marks dollar intent).
    await drain(await fetch(`http://localhost:${PORT}/quotes`, {
      method: "POST", headers: auth, body: JSON.stringify({ summary: "x", lineItems: [], status: "sent", estimatedTotal: 1_000_00 }),
    }));
    await drain(await fetch(`http://localhost:${PORT}/quotes`, {
      method: "POST", headers: auth, body: JSON.stringify({ summary: "y", lineItems: [], status: "sent", estimatedTotal: 2_500_00 }),
    }));

    const stats = await fetch(`http://localhost:${PORT}/analytics/dashboard`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(stats.customers, 1);
    assertEquals(stats.quotes.sent, 2);
    assertEquals(stats.awaitingResponse, 2);
    assertEquals(stats.quotedValueCents, 1_000_00 + 2_500_00);   // identity sum of cents
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("analytics e2e: A's stats and B's stats are isolated", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sidA = await login(PORT, "+15125551234");
    const sidB = await login(PORT, "+15125559999");
    await drain(await fetch(`http://localhost:${PORT}/customers`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sidA },
      body: JSON.stringify({ name: "A's customer" }),
    }));
    const a = await fetch(`http://localhost:${PORT}/analytics/dashboard`, { headers: { "x-session-id": sidA } }).then((r) => r.json());
    const b = await fetch(`http://localhost:${PORT}/analytics/dashboard`, { headers: { "x-session-id": sidB } }).then((r) => r.json());
    assertEquals(a.customers, 1);
    assertEquals(b.customers, 0);
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("analytics e2e: GET /analytics/dashboard without session is rejected", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const res = await fetch(`http://localhost:${PORT}/analytics/dashboard`);
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  } finally {
    await server.stop();
    await resetKv();
  }
});
