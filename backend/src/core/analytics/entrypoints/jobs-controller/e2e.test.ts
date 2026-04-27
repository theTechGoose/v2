import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { CoreModule } from "@core/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [CoreModule] })
class TestApp {}

const PORT = 9091;

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

Deno.test("jobs e2e: GET /jobs returns [] for fresh user", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const jobs = await fetch(`http://localhost:${PORT}/jobs`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(jobs, []);
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("jobs e2e: GET /jobs synthesizes Job from quote+customer (awaiting)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const auth = { "content-type": "application/json", "x-session-id": sid };

    const customer = await fetch(`http://localhost:${PORT}/customers`, {
      method: "POST", headers: auth, body: JSON.stringify({ name: "Acme Roofing" }),
    }).then((r) => r.json());
    const quote = await fetch(`http://localhost:${PORT}/quotes`, {
      method: "POST", headers: auth, body: JSON.stringify({
        customerId: customer.id, summary: "Roof tear-off", lineItems: [],
        status: "sent", estimatedTotal: 12_500,
      }),
    }).then((r) => r.json());

    const jobs = await fetch(`http://localhost:${PORT}/jobs`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());

    assertEquals(jobs.length, 1);
    assertEquals(jobs[0].customer.name, "Acme Roofing");
    assertEquals(jobs[0].quote.id, quote.id);
    assertEquals(jobs[0].quote.estimatedTotal, 12_500);
    assertEquals(jobs[0].status, "awaiting");
    assertEquals(jobs[0].statusLabel, "Awaiting signature");
    assertEquals(jobs[0].contract, null);
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("jobs e2e: GET /jobs marks overdue when an invoice is past due", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const auth = { "content-type": "application/json", "x-session-id": sid };

    const customer = await fetch(`http://localhost:${PORT}/customers`, {
      method: "POST", headers: auth, body: JSON.stringify({ name: "Slowpay LLC" }),
    }).then((r) => r.json());
    const quote = await fetch(`http://localhost:${PORT}/quotes`, {
      method: "POST", headers: auth, body: JSON.stringify({
        customerId: customer.id, summary: "Driveway", lineItems: [],
        status: "accepted", estimatedTotal: 8_000,
      }),
    }).then((r) => r.json());
    const contract = await fetch(`http://localhost:${PORT}/contracts`, {
      method: "POST", headers: auth, body: JSON.stringify({
        quoteId: quote.id, customerId: customer.id, status: "signed", totalAmount: 8_000,
      }),
    }).then((r) => r.json());
    await drain(await fetch(`http://localhost:${PORT}/invoices`, {
      method: "POST", headers: auth, body: JSON.stringify({
        contractId: contract.id, customerId: customer.id, dueDate: "2020-01-01",
        amount: 8_000, status: "pending",
      }),
    }));

    const jobs = await fetch(`http://localhost:${PORT}/jobs`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(jobs.length, 1);
    assertEquals(jobs[0].status, "overdue");
    assertEquals(jobs[0].statusLabel, "Overdue");
    assertEquals(jobs[0].nextDueDate, "2020-01-01");
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("jobs e2e: A's jobs and B's jobs are isolated", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sidA = await login(PORT, "+15125551234");
    const sidB = await login(PORT, "+15125559999");
    const authA = { "content-type": "application/json", "x-session-id": sidA };

    const customer = await fetch(`http://localhost:${PORT}/customers`, {
      method: "POST", headers: authA, body: JSON.stringify({ name: "A's customer" }),
    }).then((r) => r.json());
    await drain(await fetch(`http://localhost:${PORT}/quotes`, {
      method: "POST", headers: authA, body: JSON.stringify({
        customerId: customer.id, summary: "x", lineItems: [], status: "sent", estimatedTotal: 100,
      }),
    }));

    const aJobs = await fetch(`http://localhost:${PORT}/jobs`, { headers: { "x-session-id": sidA } }).then((r) => r.json());
    const bJobs = await fetch(`http://localhost:${PORT}/jobs`, { headers: { "x-session-id": sidB } }).then((r) => r.json());
    assertEquals(aJobs.length, 1);
    assertEquals(bJobs.length, 0);
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("jobs e2e: GET /jobs without session is rejected", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const res = await fetch(`http://localhost:${PORT}/jobs`);
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  } finally {
    await server.stop();
    await resetKv();
  }
});
