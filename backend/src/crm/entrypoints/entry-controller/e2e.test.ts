import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { CrmModule } from "@crm/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, CrmModule] })
class TestApp {}

const PORT = 9019;

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

Deno.test("entry e2e: list entries scoped to a single account (per user)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const auth = { "content-type": "application/json", "x-session-id": sid };

    const a = await fetch(`http://localhost:${PORT}/accounts`, {
      method: "POST", headers: auth,
      body: JSON.stringify({ name: "Acme — ledger", customerId: "cust-1" }),
    }).then((r) => r.json());
    const b = await fetch(`http://localhost:${PORT}/accounts`, {
      method: "POST", headers: auth,
      body: JSON.stringify({ name: "Beta — ledger", customerId: "cust-2" }),
    }).then((r) => r.json());

    await drain(await fetch(`http://localhost:${PORT}/entries`, {
      method: "POST", headers: auth,
      body: JSON.stringify({ accountId: a.id, amount: -100, occurredAt: "2026-04-26" }),
    }));
    await drain(await fetch(`http://localhost:${PORT}/entries`, {
      method: "POST", headers: auth,
      body: JSON.stringify({ accountId: b.id, amount: -200, occurredAt: "2026-04-26" }),
    }));

    const aEntries = await fetch(`http://localhost:${PORT}/entries?accountId=${a.id}`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(aEntries.length, 1);
    assertEquals(aEntries[0].amount, -100);
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("entry e2e: another user's entries are not visible", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sidA = await login(PORT, "+15125551234");
    const sidB = await login(PORT, "+15125559999");
    await drain(await fetch(`http://localhost:${PORT}/entries`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sidA },
      body: JSON.stringify({ accountId: "shared-id", amount: 100, occurredAt: "2026-04-26" }),
    }));
    const bEntries = await fetch(`http://localhost:${PORT}/entries?accountId=shared-id`, {
      headers: { "x-session-id": sidB },
    }).then((r) => r.json());
    assertEquals(bEntries, []);
  } finally {
    await server.stop();
    await resetKv();
  }
});
