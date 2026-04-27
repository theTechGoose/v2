import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AgentsModule } from "@agents/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [AgentsModule] })
class TestApp {}

const PORT = 9071;

async function drain(res: Response) { await res.body?.cancel(); }

async function withServer(fn: (port: number) => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try { await fn(PORT); } finally {
    await server.stop();
    await resetKv();
  }
}

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

Deno.test("agents chat e2e: POST without conversationId creates a new conversation and returns the turn", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const result = await fetch(`http://localhost:${port}/agents/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ content: "Garage epoxy floor for the Hernandez family" }),
    }).then((r) => r.json());

    assertEquals(typeof result.conversation.id, "string");
    assertEquals(result.conversation.currentPhase, "quote");
    assertEquals(result.newMessages.length, 2);
    assertEquals(result.newMessages[0].role, "user");
    assertEquals(result.newMessages[1].role, "assistant");
    assert(result.newMessages[1].content.startsWith("(stub)"), "stub LLM echoes user input");
  });
});

Deno.test("agents chat e2e: subsequent POST with the same conversationId continues the thread", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const turn1 = await fetch(`http://localhost:${port}/agents/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ content: "first" }),
    }).then((r) => r.json());

    const turn2 = await fetch(`http://localhost:${port}/agents/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ conversationId: turn1.conversation.id, content: "second" }),
    }).then((r) => r.json());

    assertEquals(turn2.conversation.id, turn1.conversation.id);
    const snap = await fetch(`http://localhost:${port}/agents/conversations/${turn1.conversation.id}`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(snap.messages.length, 4);                   // 2 turns × 2 messages each
  });
});

Deno.test("agents chat e2e: POST with empty content rejects", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const res = await fetch(`http://localhost:${port}/agents/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ content: "" }),
    });
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  });
});

Deno.test("agents chat e2e: POST without session is rejected", async () => {
  await withServer(async (port) => {
    const res = await fetch(`http://localhost:${port}/agents/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "no auth" }),
    });
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  });
});

Deno.test("agents chat e2e: another user cannot post into someone else's conversation", async () => {
  await withServer(async (port) => {
    const sidA = await login(port, "+15125551234");
    const sidB = await login(port, "+15125559999");
    const turn = await fetch(`http://localhost:${port}/agents/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sidA },
      body: JSON.stringify({ content: "hi" }),
    }).then((r) => r.json());

    const res = await fetch(`http://localhost:${port}/agents/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sidB },
      body: JSON.stringify({ conversationId: turn.conversation.id, content: "intruder" }),
    });
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  });
});
