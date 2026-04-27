import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { CommunicationModule } from "@communication/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, CommunicationModule] })
class TestApp {}

const PORT = 9015;

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

Deno.test("conversation e2e: POST then GET returns same id for owner", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const created = await fetch(`http://localhost:${PORT}/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ title: "kickoff" }),
    }).then((r) => r.json());
    assertEquals(created.title, "kickoff");

    const fetched = await fetch(`http://localhost:${PORT}/conversations/${created.id}`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(fetched.id, created.id);
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("conversation e2e: cross-user GET is forbidden", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sidA = await login(PORT, "+15125551234");
    const sidB = await login(PORT, "+15125559999");
    const c = await fetch(`http://localhost:${PORT}/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sidA },
      body: JSON.stringify({ title: "A's" }),
    }).then((r) => r.json());
    const res = await fetch(`http://localhost:${PORT}/conversations/${c.id}`, {
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
