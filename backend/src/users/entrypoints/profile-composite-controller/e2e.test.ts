import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule] })
class TestApp {}

const PORT = 9062;

async function drain(res: Response): Promise<void> {
  await res.body?.cancel();
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

async function login(port: number, phone = "+15125551234"): Promise<{ sessionId: string; userId: string }> {
  await drain(await fetch(`http://localhost:${port}/auth/send-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone }),
  }));
  const stored = await new OtpStore().get(phone);
  return await fetch(`http://localhost:${port}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
}

Deno.test("profile composite e2e: GET /profile returns user + null aggregates for fresh signup", async () => {
  await withServer(async (port) => {
    const session = await login(port);
    const snap = await fetch(`http://localhost:${port}/profile`, {
      headers: { "x-session-id": session.sessionId },
    }).then((r) => r.json());
    assertEquals(snap.user.id, session.userId);
    assertEquals(snap.identity, null);
    assertEquals(snap.contractDefaults, null);
    assertEquals(snap.initials, "?");
  });
});

Deno.test("profile composite e2e: GET /profile returns sub-aggregates after population", async () => {
  await withServer(async (port) => {
    const session = await login(port);
    await drain(await fetch(`http://localhost:${port}/me`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-session-id": session.sessionId },
      body: JSON.stringify({ name: "Diego R." }),
    }));
    await drain(await fetch(`http://localhost:${port}/profile/identity`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-session-id": session.sessionId },
      body: JSON.stringify({ businessName: "Riley Roofing Co.", legalName: "Riley & Sons LLC" }),
    }));
    await drain(await fetch(`http://localhost:${port}/profile/contract-defaults`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-session-id": session.sessionId },
      body: JSON.stringify({ warrantyMonths: 12, governingState: "TX" }),
    }));

    const snap = await fetch(`http://localhost:${port}/profile`, {
      headers: { "x-session-id": session.sessionId },
    }).then((r) => r.json());
    assertEquals(snap.user.name, "Diego R.");
    assertEquals(snap.identity.businessName, "Riley Roofing Co.");
    assertEquals(snap.contractDefaults.warrantyMonths, 12);
    assertEquals(snap.initials, "DR");
  });
});

Deno.test("profile composite e2e: GET /profile/:userId/public is reachable without session and returns safe subset", async () => {
  await withServer(async (port) => {
    const session = await login(port);
    await drain(await fetch(`http://localhost:${port}/profile/identity`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-session-id": session.sessionId },
      body: JSON.stringify({
        businessName: "Riley Roofing Co.",
        legalName: "Riley & Sons LLC",        // private — should NOT appear publicly
        businessLicense: "TX-123",
      }),
    }));

    const pub = await fetch(`http://localhost:${port}/profile/${session.userId}/public`).then((r) => r.json());
    assertEquals(pub.identity.businessName, "Riley Roofing Co.");
    assertEquals(pub.identity.businessLicense, "TX-123");
    assert(!("legalName" in pub.identity), "legalName must NOT leak to public endpoint");
    assert(!("userId"    in pub.identity), "userId must NOT leak to public endpoint");
  });
});

Deno.test("profile composite e2e: GET /profile without session is rejected", async () => {
  await withServer(async (port) => {
    const res = await fetch(`http://localhost:${port}/profile`);
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  });
});
