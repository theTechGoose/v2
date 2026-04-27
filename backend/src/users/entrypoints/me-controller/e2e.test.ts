import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule] })
class TestApp {}

const PORT = 9051;

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

async function drain(res: Response): Promise<void> {
  await res.body?.cancel();
}

async function login(port: number, phoneNumber: string, language?: string): Promise<{ sessionId: string; userId: string }> {
  await drain(await fetch(`http://localhost:${port}/auth/send-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber, language }),
  }));
  const otps = new OtpStore();
  const stored = await otps.get(phoneNumber);
  const verify = await fetch(`http://localhost:${port}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber, code: stored!.code }),
  }).then((r) => r.json());
  return verify;
}

Deno.test("me e2e: GET /me with valid session returns the user", async () => {
  await withServer(async (port) => {
    const session = await login(port, "+15125551234", "es");
    const res = await fetch(`http://localhost:${port}/me`, {
      headers: { "x-session-id": session.sessionId },
    });
    const body = await res.json();
    assertEquals(body.id, session.userId);
    assertEquals(body.phoneNumber, "+15125551234");
    assertEquals(body.language, "es");
  });
});

Deno.test("me e2e: PUT /me updates name + email and bumps updatedAt", async () => {
  await withServer(async (port) => {
    const session = await login(port, "+15125551234");
    const before = await fetch(`http://localhost:${port}/me`, {
      headers: { "x-session-id": session.sessionId },
    }).then((r) => r.json());

    await new Promise((r) => setTimeout(r, 10));
    const updated = await fetch(`http://localhost:${port}/me`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-session-id": session.sessionId },
      body: JSON.stringify({ name: "Diego R.", email: "diego@test.dev" }),
    }).then((r) => r.json());

    assertEquals(updated.name, "Diego R.");
    assertEquals(updated.email, "diego@test.dev");
    assertEquals(updated.id, session.userId);
    assert(updated.updatedAt > before.updatedAt, "updatedAt should advance");
  });
});

Deno.test("me e2e: PUT /me with language switches preference", async () => {
  await withServer(async (port) => {
    const session = await login(port, "+15125551234", "en");
    const updated = await fetch(`http://localhost:${port}/me`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-session-id": session.sessionId },
      body: JSON.stringify({ language: "es" }),
    }).then((r) => r.json());
    assertEquals(updated.language, "es");
  });
});

Deno.test("me e2e: GET /me without session header is rejected", async () => {
  await withServer(async (port) => {
    const res = await fetch(`http://localhost:${port}/me`);
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false, "missing session must be rejected");
  });
});

Deno.test("me e2e: GET /me with bogus session header is rejected", async () => {
  await withServer(async (port) => {
    const res = await fetch(`http://localhost:${port}/me`, {
      headers: { "x-session-id": "not-a-real-session" },
    });
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false, "invalid session must be rejected");
  });
});

Deno.test("me e2e: DELETE /me closes the account", async () => {
  await withServer(async (port) => {
    const session = await login(port, "+15125551234");
    const del = await fetch(`http://localhost:${port}/me`, {
      method: "DELETE",
      headers: { "x-session-id": session.sessionId },
    });
    assertEquals(await del.json(), { ok: true });

    const after = await fetch(`http://localhost:${port}/me`, {
      headers: { "x-session-id": session.sessionId },
    });
    const okAfter = after.ok;
    await drain(after);
    assertEquals(okAfter, false, "session is gone after account close");
  });
});
