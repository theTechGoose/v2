import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, PaperworkModule] })
class TestApp {}

const PORT = 9028;

async function drain(res: Response) { await res.body?.cancel(); }

async function login(port: number, phone = "+15125557777"): Promise<string> {
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

Deno.test("payment e2e: create + list-by-invoice + cross-user 403", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sidA = await login(PORT, "+15125557701");
    const sidB = await login(PORT, "+15125557702");
    const authA = { "content-type": "application/json", "x-session-id": sidA };
    const authB = { "content-type": "application/json", "x-session-id": sidB };

    const inv = await fetch(`http://localhost:${PORT}/invoices`, {
      method: "POST", headers: authA,
      body: JSON.stringify({ contractId: "c-1", dueDate: "2026-05-01", amount: 200, status: "pending" }),
    }).then((r) => r.json());

    const pay = await fetch(`http://localhost:${PORT}/payments`, {
      method: "POST", headers: authA,
      body: JSON.stringify({
        invoiceId: inv.id, amount: 50, method: "cash", receivedAt: "2026-04-15T00:00:00.000Z",
      }),
    }).then((r) => r.json());
    assertEquals(pay.amount, 50);
    assertEquals(pay.method, "cash");

    const listA = await fetch(`http://localhost:${PORT}/payments?invoiceId=${inv.id}`, {
      headers: { "x-session-id": sidA },
    }).then((r) => r.json());
    assertEquals(listA.length, 1);

    const listB = await fetch(`http://localhost:${PORT}/payments?invoiceId=${inv.id}`, {
      headers: { "x-session-id": sidB },
    }).then((r) => r.json());
    assertEquals(listB.length, 0);

    const crossPay = await fetch(`http://localhost:${PORT}/payments`, {
      method: "POST", headers: authB,
      body: JSON.stringify({
        invoiceId: inv.id, amount: 1, method: "cash", receivedAt: "2026-04-15T00:00:00.000Z",
      }),
    });
    assertEquals(crossPay.status >= 400, true);
    await drain(crossPay);
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("payment e2e: closing the balance flips the invoice to paid", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT, "+15125557703");
    const auth = { "content-type": "application/json", "x-session-id": sid };

    const inv = await fetch(`http://localhost:${PORT}/invoices`, {
      method: "POST", headers: auth,
      body: JSON.stringify({ contractId: "c-1", dueDate: "2026-05-01", amount: 100, status: "pending" }),
    }).then((r) => r.json());

    await drain(await fetch(`http://localhost:${PORT}/payments`, {
      method: "POST", headers: auth,
      body: JSON.stringify({
        invoiceId: inv.id, amount: 100, method: "card", receivedAt: "2026-04-15T00:00:00.000Z",
      }),
    }));

    const after = await fetch(`http://localhost:${PORT}/invoices/${inv.id}`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(after.status, "paid");
    assertEquals(after.paidAt, "2026-04-15T00:00:00.000Z");
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("payment e2e: DELETE removes the payment and reopens the invoice", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT, "+15125557704");
    const auth = { "content-type": "application/json", "x-session-id": sid };

    const inv = await fetch(`http://localhost:${PORT}/invoices`, {
      method: "POST", headers: auth,
      body: JSON.stringify({ contractId: "c-1", dueDate: "2026-05-01", amount: 100, status: "pending" }),
    }).then((r) => r.json());

    const pay = await fetch(`http://localhost:${PORT}/payments`, {
      method: "POST", headers: auth,
      body: JSON.stringify({
        invoiceId: inv.id, amount: 100, method: "ach", receivedAt: "2026-04-15T00:00:00.000Z",
      }),
    }).then((r) => r.json());

    const del = await fetch(`http://localhost:${PORT}/payments/${pay.id}`, {
      method: "DELETE",
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(del.ok, true);

    const after = await fetch(`http://localhost:${PORT}/invoices/${inv.id}`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(after.status, "pending");
  } finally {
    await server.stop();
    await resetKv();
  }
});
