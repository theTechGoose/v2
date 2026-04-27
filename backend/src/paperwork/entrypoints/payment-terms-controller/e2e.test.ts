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

const PORT = 9021;

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

Deno.test("payment-terms e2e: create with percents, /check confirms balance, /resolve applies to a total", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const terms = await fetch(`http://localhost:${PORT}/payment-terms`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({
        name: "30 / 30 / 40",
        installments: [
          { percent: 30, dueDate: "2026-05-01", label: "Deposit" },
          { percent: 30, dueDate: "2026-06-01", label: "Mid-job" },
          { percent: 40, dueDate: "2026-07-01", label: "Final" },
        ],
      }),
    }).then((r) => r.json());

    assertEquals(terms.installments.length, 3);
    assertEquals(terms.installments[0].percent, 30);

    const check = await fetch(`http://localhost:${PORT}/payment-terms/${terms.id}/check`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(check.totalPercent, 100);
    assertEquals(check.isBalanced, true);

    const resolved = await fetch(`http://localhost:${PORT}/payment-terms/${terms.id}/resolve?total=1280`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(resolved.total, 1280);
    assertEquals(resolved.installments[0].amount, 384);
    assertEquals(resolved.installments[1].amount, 384);
    assertEquals(resolved.installments[2].amount, 512);
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("payment-terms e2e: cross-user /check is forbidden", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sidA = await login(PORT, "+15125551234");
    const sidB = await login(PORT, "+15125559999");
    const terms = await fetch(`http://localhost:${PORT}/payment-terms`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sidA },
      body: JSON.stringify({ name: "x", installments: [{ percent: 100, dueDate: "2026-05-01" }] }),
    }).then((r) => r.json());
    const res = await fetch(`http://localhost:${PORT}/payment-terms/${terms.id}/check`, {
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
