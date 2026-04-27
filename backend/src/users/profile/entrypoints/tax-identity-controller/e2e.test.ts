import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule] })
class TestApp {}

const PORT = 9095;

async function drain(res: Response) { await res.body?.cancel(); }

async function login(port: number, phone = "+15125551234") {
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
  return { sessionId: v.sessionId as string, userId: v.userId as string };
}

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

Deno.test("tax-identity public e2e: verify-tin returns ok:true when the TIN matches", async () => {
  await withServer(async (port) => {
    const { sessionId, userId } = await login(port);
    await drain(await fetch(`http://localhost:${port}/profile/tax`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-session-id": sessionId },
      body: JSON.stringify({ tin: "123-45-6789" }),
    }));

    const res = await fetch(`http://localhost:${port}/profile/${userId}/tax/verify`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ tin: "123-45-6789" }),
    }).then((r) => r.json());
    assertEquals(res.ok, true);
  });
});

Deno.test("tax-identity public e2e: 6th attempt within window is blocked with too_many_attempts", async () => {
  await withServer(async (port) => {
    const { sessionId, userId } = await login(port);
    await drain(await fetch(`http://localhost:${port}/profile/tax`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-session-id": sessionId },
      body: JSON.stringify({ tin: "123-45-6789" }),
    }));

    for (let i = 0; i < 5; i++) {
      const body = await fetch(`http://localhost:${port}/profile/${userId}/tax/verify`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ tin: "wrong" }),
      }).then((r) => r.json());
      // First 5 attempts are processed (and reject the wrong tin).
      assertEquals(body.ok, false);
      assertEquals(body.reason, undefined);   // not yet rate-limited
    }

    const blocked = await fetch(`http://localhost:${port}/profile/${userId}/tax/verify`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ tin: "wrong" }),
    }).then((r) => r.json());
    assertEquals(blocked.ok, false);
    assertEquals(blocked.reason, "too_many_attempts");
    assert(typeof blocked.retryAfterMs === "number");
  });
});

Deno.test("tax-identity public e2e: rate-limit is per-target — different userId is unaffected", async () => {
  await withServer(async (port) => {
    const a = await login(port, "+15125551234");
    const b = await login(port, "+15125559999");
    // A's bucket gets exhausted.
    for (let i = 0; i < 6; i++) {
      await drain(await fetch(`http://localhost:${port}/profile/${a.userId}/tax/verify`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ tin: "x" }),
      }));
    }
    // B's bucket is fresh.
    const bRes = await fetch(`http://localhost:${port}/profile/${b.userId}/tax/verify`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ tin: "x" }),
    }).then((r) => r.json());
    assertEquals(bRes.reason, undefined);     // not blocked
  });
});
