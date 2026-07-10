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

async function login(port: number, phoneNumber: string, language?: string): Promise<{ sessionId: string; userId: string; isNewUser?: boolean }> {
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

Deno.test("me e2e: POST /me/onboarded without session is rejected", async () => {
  await withServer(async (port) => {
    const res = await fetch(`http://localhost:${port}/me/onboarded`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ skipped: true }),
    });
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false, "missing session must be rejected");
  });
});

Deno.test("me e2e: POST /me/onboarded stamps onboardedAt; second call is a no-op", async () => {
  await withServer(async (port) => {
    const session = await login(port, "+15125551234");
    const before = await fetch(`http://localhost:${port}/me`, {
      headers: { "x-session-id": session.sessionId },
    }).then((r) => r.json());
    assertEquals(before.onboardedAt, undefined);

    const first = await fetch(`http://localhost:${port}/me/onboarded`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": session.sessionId },
      body: JSON.stringify({ skipped: true }),
    }).then((r) => r.json());
    assert(first.onboardedAt, "first call stamps onboardedAt");
    assertEquals(first.onboardingSkipped, true);

    await new Promise((r) => setTimeout(r, 10));
    // Second call, even with skipped:false, keeps the first timestamp + flag.
    const second = await fetch(`http://localhost:${port}/me/onboarded`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": session.sessionId },
      body: JSON.stringify({ skipped: false }),
    }).then((r) => r.json());
    assertEquals(second.onboardedAt, first.onboardedAt);
    assertEquals(second.onboardingSkipped, true);
  });
});

const RESET_SECRET = "test-reset-secret-0123456789";

Deno.test("reset-by-phone: refused when RESET_SECRET is unset (no backdoor by default)", async () => {
  await withServer(async (port) => {
    const session = await login(port, "+15125551234");
    Deno.env.delete("RESET_SECRET");
    const res = await fetch(`http://localhost:${port}/me/reset-by-phone`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-reset-secret": "anything-at-all-here" },
      body: JSON.stringify({ phoneNumber: "+15125551234" }),
    }).then((r) => r.json());
    assertEquals(res, { ok: false, error: "forbidden" });
    // user must survive
    const me = await fetch(`http://localhost:${port}/me`, {
      headers: { "x-session-id": session.sessionId },
    }).then((r) => r.json());
    assertEquals(me.id, session.userId);
  });
});

Deno.test("reset-by-phone: wrong secret is refused; account survives", async () => {
  await withServer(async (port) => {
    const session = await login(port, "+15125551234");
    Deno.env.set("RESET_SECRET", RESET_SECRET);
    try {
      const res = await fetch(`http://localhost:${port}/me/reset-by-phone`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-reset-secret": "wrong-secret-but-16+" },
        body: JSON.stringify({ phoneNumber: "+15125551234" }),
      }).then((r) => r.json());
      assertEquals(res, { ok: false, error: "forbidden" });
      const me = await fetch(`http://localhost:${port}/me`, {
        headers: { "x-session-id": session.sessionId },
      }).then((r) => r.json());
      assertEquals(me.id, session.userId, "account must survive a wrong-secret call");
    } finally {
      Deno.env.delete("RESET_SECRET");
    }
  });
});

Deno.test("reset-by-phone: correct secret wipes the user; re-login is a NEW user", async () => {
  await withServer(async (port) => {
    const session = await login(port, "+15125551234");
    // seed a little data so the sweep has something to delete beyond the user row
    await drain(await fetch(`http://localhost:${port}/me`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-session-id": session.sessionId },
      body: JSON.stringify({ name: "Wipe Me", email: "wipe@test.dev" }),
    }));

    Deno.env.set("RESET_SECRET", RESET_SECRET);
    try {
      const res = await fetch(`http://localhost:${port}/me/reset-by-phone`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-reset-secret": RESET_SECRET },
        body: JSON.stringify({ phoneNumber: "8438557133" }), // also proves normalization is independent of the seeded +1512 user
      }).then((r) => r.json());
      // different phone → nothing to delete
      assertEquals(res.ok, true);
      assertEquals(res.note, "no_such_user");

      // now wipe the real seeded user
      const real = await fetch(`http://localhost:${port}/me/reset-by-phone`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-reset-secret": RESET_SECRET },
        body: JSON.stringify({ phoneNumber: "+15125551234" }),
      }).then((r) => r.json());
      assertEquals(real.ok, true);
      assert(real.deleted > 0, "wipe should delete at least the user + index keys");
      assertEquals(real.userId, session.userId);

      // old session is gone
      const dead = await fetch(`http://localhost:${port}/me`, {
        headers: { "x-session-id": session.sessionId },
      });
      const okDead = dead.ok;
      await drain(dead);
      assertEquals(okDead, false, "old session must be invalid after wipe");

      // re-login on the same phone yields a brand-new user
      const fresh = await login(port, "+15125551234");
      assert(fresh.isNewUser, "re-login after wipe must be a fresh user");
      assert(fresh.userId !== session.userId, "a new userId is minted");
    } finally {
      Deno.env.delete("RESET_SECRET");
    }
  });
});

Deno.test("reset-by-phone: bad phone yields bad_phone (with a valid secret)", async () => {
  await withServer(async (port) => {
    Deno.env.set("RESET_SECRET", RESET_SECRET);
    try {
      const res = await fetch(`http://localhost:${port}/me/reset-by-phone`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-reset-secret": RESET_SECRET },
        body: JSON.stringify({ phoneNumber: "nope" }),
      }).then((r) => r.json());
      assertEquals(res, { ok: false, error: "bad_phone" });
    } finally {
      Deno.env.delete("RESET_SECRET");
    }
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
