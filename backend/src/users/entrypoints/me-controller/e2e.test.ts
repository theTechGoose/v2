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

/**
 * REQ-227 (demo M2) — a step's Skip in the wizard saves a per-question "deferred" stamp, so the
 * dashboard's gate can let a person past a question they put off. The name is never deferrable
 * (its step has no Skip); an unknown question is a 400; the stamp is only ever written here.
 */
Deno.test("REQ-227 me e2e: POST /me/onboarding/deferred stamps the question on the user; the name and unknown questions are 400; no session is rejected", async () => {
  await withServer(async (port) => {
    const anon = await fetch(`http://localhost:${port}/me/onboarding/deferred`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "logo" }),
    });
    assertEquals(anon.ok, false, "missing session must be rejected");
    await drain(anon);

    const session = await login(port, "+15125551234");
    const h = { "content-type": "application/json", "x-session-id": session.sessionId };
    const res = await fetch(`http://localhost:${port}/me/onboarding/deferred`, {
      method: "POST", headers: h, body: JSON.stringify({ question: "logo" }),
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assert(body.onboardingDeferred?.logo, "the logo carries a deferred stamp");
    assert(!Number.isNaN(Date.parse(body.onboardingDeferred.logo)), "the stamp is an ISO time");

    await drain(await fetch(`http://localhost:${port}/me/onboarding/deferred`, {
      method: "POST", headers: h, body: JSON.stringify({ question: "insurance" }),
    }));
    const me = await fetch(`http://localhost:${port}/me`, { headers: h }).then((r) => r.json());
    assertEquals(Object.keys(me.onboardingDeferred).sort(), ["insurance", "logo"]);

    for (const question of ["name", "nope", 42, undefined]) {
      const bad = await fetch(`http://localhost:${port}/me/onboarding/deferred`, {
        method: "POST", headers: h, body: JSON.stringify({ question }),
      });
      assertEquals(bad.status, 400, `${String(question)} cannot be deferred`);
      await drain(bad);
    }

    // a PUT /me body cannot smuggle a deferral in
    await drain(await fetch(`http://localhost:${port}/me`, {
      method: "PUT", headers: h, body: JSON.stringify({ name: "Ana", onboardingDeferred: { name: "x", email: "x" } }),
    }));
    const after = await fetch(`http://localhost:${port}/me`, { headers: h }).then((r) => r.json());
    assertEquals(Object.keys(after.onboardingDeferred).sort(), ["insurance", "logo"]);
  });
});

/**
 * REQ-504 (demo-loop cycle 3, issue M37) — "Skip setup for now" left the dashboard unreachable: the
 * escape stamped only `onboardedAt` (a record, not a gate), so every open question still kept the
 * dashboard shut and its sidebar link looped back to the wizard. `{ skipped: true, deferAll: true }`
 * now stamps every OPEN deferrable question deferred (REQ-227), so the dashboard opens and its setup
 * checklist asks for the rest. The name is never deferred; answered questions get no stamp; a bare
 * `{ skipped: true }` (and a finish) still stamps nothing.
 */
Deno.test("REQ-504 me e2e: POST /me/onboarded { skipped, deferAll } defers every open deferrable question so the dashboard's gate opens; answered ones and the name are never stamped; a bare skip stamps nothing", async () => {
  const { dashboardBlockers } = await import("#quote-flow/onboarding-questions.ts");
  await withServer(async (port) => {
    const base = `http://localhost:${port}`;
    const session = await login(port, "+15125551250");
    const h = { "content-type": "application/json", "x-session-id": session.sessionId };
    // the demo's path: the name, the business name and the email answered, then the escape
    await drain(await fetch(`${base}/me`, { method: "PUT", headers: h, body: JSON.stringify({ name: "Ana", email: "ana@roof.test" }) }));
    await drain(await fetch(`${base}/profile/identity`, { method: "PUT", headers: h, body: JSON.stringify({ businessName: "Ana Roofing" }) }));
    const before = await fetch(`${base}/profile`, { headers: h }).then((r) => r.json());
    assert(dashboardBlockers(before).length > 0, "before the escape the dashboard is shut");

    const left = await fetch(`${base}/me/onboarded`, { method: "POST", headers: h, body: JSON.stringify({ skipped: true, deferAll: true }) });
    assertEquals(left.status, 200);
    const body = await left.json();
    assert(body.onboardedAt, "the leave is still recorded");
    assertEquals(
      Object.keys(body.onboardingDeferred ?? {}).sort(),
      ["address", "insurance", "logo", "payment", "plan", "state"],
      "every open deferrable question is deferred — not the answered business name or email",
    );
    const after = await fetch(`${base}/profile`, { headers: h }).then((r) => r.json());
    assertEquals(dashboardBlockers(after), [], "after the escape nothing keeps the dashboard shut");

    // the name can never be deferred: an account without one is still held at the name
    const nameless = await login(port, "+15125551251");
    const hn = { "content-type": "application/json", "x-session-id": nameless.sessionId };
    const n = await fetch(`${base}/me/onboarded`, { method: "POST", headers: hn, body: JSON.stringify({ skipped: true, deferAll: true }) }).then((r) => r.json());
    assertEquals(n.onboardingDeferred?.name, undefined, "the name is never deferred");
    const np = await fetch(`${base}/profile`, { headers: hn }).then((r) => r.json());
    assertEquals(dashboardBlockers(np), ["name"], "only the name still holds the dashboard");

    // a bare skip (and a finish) stamps nothing
    const bare = await login(port, "+15125551252");
    const hb = { "content-type": "application/json", "x-session-id": bare.sessionId };
    const b = await fetch(`${base}/me/onboarded`, { method: "POST", headers: hb, body: JSON.stringify({ skipped: true }) }).then((r) => r.json());
    assertEquals(b.onboardingDeferred, undefined, "a bare skip defers nothing");
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
