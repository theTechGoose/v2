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

const PORT = 9016;

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

Deno.test("message e2e: posting a message into your own conversation works", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const auth = { "content-type": "application/json", "x-session-id": sid };

    const conv = await fetch(`http://localhost:${PORT}/conversations`, {
      method: "POST", headers: auth, body: JSON.stringify({ title: "kickoff" }),
    }).then((r) => r.json());

    await drain(await fetch(`http://localhost:${PORT}/messages`, {
      method: "POST", headers: auth,
      body: JSON.stringify({ conversationId: conv.id, role: "user", channel: "web", content: "hi" }),
    }));

    const filtered = await fetch(`http://localhost:${PORT}/messages?conversationId=${conv.id}`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(filtered.length, 1);
    assertEquals(filtered[0].conversationId, conv.id);
    assertEquals(filtered[0].channel, "web");
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("message e2e: posting into someone else's conversation is forbidden", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sidA = await login(PORT, "+15125551234");
    const sidB = await login(PORT, "+15125559999");
    const conv = await fetch(`http://localhost:${PORT}/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sidA },
      body: JSON.stringify({ title: "A's" }),
    }).then((r) => r.json());

    const res = await fetch(`http://localhost:${PORT}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sidB },
      body: JSON.stringify({ conversationId: conv.id, role: "user", channel: "web", content: "intruder" }),
    });
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("message e2e: GET /messages without conversationId is rejected", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const res = await fetch(`http://localhost:${PORT}/messages`, {
      headers: { "x-session-id": sid },
    });
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  } finally {
    await server.stop();
    await resetKv();
  }
});
