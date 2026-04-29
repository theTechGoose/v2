import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AgentsModule } from "@agents/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [AgentsModule] })
class TestApp {}

const PORT = 9070;

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

Deno.test("agents conversations e2e: POST creates a fresh conversation in 'quote' phase", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const conv = await fetch(`http://localhost:${port}/agents/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({}),
    }).then((r) => r.json());
    assertEquals(conv.currentPhase, "quote");
    assertEquals(typeof conv.id, "string");
  });
});

Deno.test("agents conversations e2e: GET list returns newest-first scoped to caller", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const a = await fetch(`http://localhost:${port}/agents/conversations`, {
      method: "POST", headers: { "content-type": "application/json", "x-session-id": sid }, body: "{}",
    }).then((r) => r.json());
    await new Promise((r) => setTimeout(r, 5));
    const b = await fetch(`http://localhost:${port}/agents/conversations`, {
      method: "POST", headers: { "content-type": "application/json", "x-session-id": sid }, body: "{}",
    }).then((r) => r.json());

    const list = await fetch(`http://localhost:${port}/agents/conversations`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(list.length, 2);
    assertEquals(list[0].id, b.id);
    assertEquals(list[1].id, a.id);
  });
});

Deno.test("agents conversations e2e: GET list does not leak across users", async () => {
  await withServer(async (port) => {
    const sidA = await login(port, "+15125551234");
    const sidB = await login(port, "+15125559999");
    await fetch(`http://localhost:${port}/agents/conversations`, {
      method: "POST", headers: { "content-type": "application/json", "x-session-id": sidA }, body: "{}",
    }).then(drain);
    const bList = await fetch(`http://localhost:${port}/agents/conversations`, {
      headers: { "x-session-id": sidB },
    }).then((r) => r.json());
    assertEquals(bList, []);
  });
});

Deno.test("agents conversations e2e: GET /:id returns conversation + empty messages for fresh conv", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const conv = await fetch(`http://localhost:${port}/agents/conversations`, {
      method: "POST", headers: { "content-type": "application/json", "x-session-id": sid }, body: "{}",
    }).then((r) => r.json());
    const snap = await fetch(`http://localhost:${port}/agents/conversations/${conv.id}`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(snap.conversation.id, conv.id);
    assertEquals(snap.messages, []);
    assertEquals(snap.wizard, undefined);
  });
});

Deno.test("agents conversations e2e: POST /:id/transition-to-terms flips phase + appends divider + wizard", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const conv = await fetch(`http://localhost:${port}/agents/conversations`, {
      method: "POST", headers: { "content-type": "application/json", "x-session-id": sid }, body: "{}",
    }).then((r) => r.json());

    const result = await fetch(`http://localhost:${port}/agents/conversations/${conv.id}/transition-to-terms`, {
      method: "POST", headers: { "x-session-id": sid },
    }).then((r) => r.json());

    assertEquals(result.conversation.currentPhase, "terms");
    assertEquals(result.newMessages.length, 2);
    assertEquals(result.newMessages[0].kind, "phase_divider");
    assertEquals(result.newMessages[1].kind, "wizard");
  });
});

Deno.test("agents conversations e2e: DELETE removes the conversation", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const conv = await fetch(`http://localhost:${port}/agents/conversations`, {
      method: "POST", headers: { "content-type": "application/json", "x-session-id": sid }, body: "{}",
    }).then((r) => r.json());
    const del = await fetch(`http://localhost:${port}/agents/conversations/${conv.id}`, {
      method: "DELETE", headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(del, { ok: true });

    const after = await fetch(`http://localhost:${port}/agents/conversations`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(after, []);
  });
});

Deno.test("agents conversations e2e: GET /:id/phase returns the projected phase state", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const conv = await fetch(`http://localhost:${port}/agents/conversations`, {
      method: "POST", headers: { "content-type": "application/json", "x-session-id": sid }, body: "{}",
    }).then((r) => r.json());

    const fresh = await fetch(`http://localhost:${port}/agents/conversations/${conv.id}/phase`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(fresh.currentPhase, "quote");
    assertEquals(fresh.canAdvance, false);
    assertEquals(fresh.nextPhaseHint, "terms");
    assertEquals(fresh.quoteId, undefined);

    await fetch(`http://localhost:${port}/agents/conversations/${conv.id}/transition-to-terms`, {
      method: "POST", headers: { "x-session-id": sid },
    }).then(drain);

    const after = await fetch(`http://localhost:${port}/agents/conversations/${conv.id}/phase`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(after.currentPhase, "terms");
    assertEquals(after.canAdvance, false);
    assertEquals(after.nextPhaseHint, undefined);
  });
});

Deno.test("agents conversations e2e: GET without session is rejected", async () => {
  await withServer(async (port) => {
    const res = await fetch(`http://localhost:${port}/agents/conversations`);
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  });
});
