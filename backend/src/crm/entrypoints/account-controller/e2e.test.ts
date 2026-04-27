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

const PORT = 9018;

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

Deno.test("account e2e: charge → balance negative; payment → balance settles to 0", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const auth = { "content-type": "application/json", "x-session-id": sid };

    const customer = await fetch(`http://localhost:${PORT}/customers`, {
      method: "POST", headers: auth, body: JSON.stringify({ name: "Acme" }),
    }).then((r) => r.json());

    const account = await fetch(`http://localhost:${PORT}/accounts`, {
      method: "POST", headers: auth,
      body: JSON.stringify({ name: "Acme — ledger", customerId: customer.id }),
    }).then((r) => r.json());

    await drain(await fetch(`http://localhost:${PORT}/entries`, {
      method: "POST", headers: auth,
      body: JSON.stringify({ accountId: account.id, amount: -1280, occurredAt: "2026-04-26" }),
    }));

    const afterCharge = await fetch(`http://localhost:${PORT}/accounts/${account.id}/balance`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(afterCharge.balance.balance, -1280);
    assertEquals(afterCharge.balance.charges, 1280);
    assertEquals(afterCharge.balance.payments, 0);

    await drain(await fetch(`http://localhost:${PORT}/entries`, {
      method: "POST", headers: auth,
      body: JSON.stringify({ accountId: account.id, amount: 1280, occurredAt: "2026-04-30" }),
    }));

    const afterPayment = await fetch(`http://localhost:${PORT}/accounts/${account.id}/balance`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(afterPayment.balance.balance, 0);
    assertEquals(afterPayment.balance.payments, 1280);

    const byCustomer = await fetch(`http://localhost:${PORT}/accounts?customerId=${customer.id}`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(byCustomer.length, 1);
    assertEquals(byCustomer[0].id, account.id);
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("account e2e: another user cannot read someone else's balance", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sidA = await login(PORT, "+15125551234");
    const sidB = await login(PORT, "+15125559999");
    const a = await fetch(`http://localhost:${PORT}/accounts`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sidA },
      body: JSON.stringify({ name: "A" }),
    }).then((r) => r.json());
    const res = await fetch(`http://localhost:${PORT}/accounts/${a.id}/balance`, {
      headers: { "x-session-id": sidB },
    });
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  } finally {
    await server.stop();
    await resetKv();
  }
});
