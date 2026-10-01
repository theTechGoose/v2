import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule] })
class TestApp {}

const PORT = 9050;

async function withServer(fn: (port: number) => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    await fn(PORT);
  } finally {
    await server.stop();
    await resetKv();
  }
}

Deno.test("auth e2e: send-otp persists OTP record and replies { sent: true }", async () => {
  await withServer(async (port) => {
    const res = await fetch(`http://localhost:${port}/auth/send-otp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneNumber: "(512) 555-1234", language: "es" }),
    });
    const body = await res.json();
    assertEquals(body, { sent: true });

    const otps = new OtpStore();
    const stored = await otps.get("+15125551234");
    assert(stored, "OTP record should exist");
    assertEquals(stored.language, "es");
    assert(/^\d{6}$/.test(stored.code), "code should be 6 digits");
  });
});

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function drain(res: Response): Promise<void> {
  await res.body?.cancel();
}

Deno.test("auth e2e: full happy path — send-otp → verify-otp returns sessionId+userId", async () => {
  await withServer(async (port) => {
    await drain(
      await postJson(`http://localhost:${port}/auth/send-otp`, {
        phoneNumber: "+15125551234",
        language: "en",
      }),
    );
    const otps = new OtpStore();
    const otp = await otps.get("+15125551234");

    const body = await postJson(`http://localhost:${port}/auth/verify-otp`, {
      phoneNumber: "+15125551234",
      code: otp!.code,
    }).then((r) => r.json());
    assert(typeof body.sessionId === "string", "sessionId should be returned");
    assert(typeof body.userId === "string", "userId should be returned");
    assertEquals(
      await otps.get("+15125551234"),
      null,
      "OTP record should be cleared on success",
    );
  });
});

Deno.test("auth e2e: verify-otp with wrong code returns invalid_code error body", async () => {
  await withServer(async (port) => {
    await drain(
      await postJson(`http://localhost:${port}/auth/send-otp`, {
        phoneNumber: "+15125551234",
      }),
    );
    // Derive a wrong code from the real one — and never "000000", which is the
    // non-prod DEV_MASTER_CODE that bypasses verification and would log in.
    const otps = new OtpStore();
    const real = await otps.get("+15125551234");
    const wrong = real!.code === "111111" ? "222222" : "111111";
    const body = await postJson(`http://localhost:${port}/auth/verify-otp`, {
      phoneNumber: "+15125551234",
      code: wrong,
    }).then((r) => r.json());
    assertEquals(body.ok, false);
    assertEquals(body.error, "invalid_code");
  });
});

Deno.test("auth e2e: verify-otp with no preceding send-otp returns expired error body", async () => {
  await withServer(async (port) => {
    const body = await postJson(`http://localhost:${port}/auth/verify-otp`, {
      phoneNumber: "+15125551234",
      code: "123456",
    }).then((r) => r.json());
    assertEquals(body.ok, false);
    assertEquals(body.error, "expired");
  });
});

Deno.test("auth e2e: logout with valid session id returns ok and removes the session", async () => {
  await withServer(async (port) => {
    await drain(
      await postJson(`http://localhost:${port}/auth/send-otp`, {
        phoneNumber: "+15125551234",
      }),
    );
    const otps = new OtpStore();
    const otp = await otps.get("+15125551234");
    const verify = await postJson(`http://localhost:${port}/auth/verify-otp`, {
      phoneNumber: "+15125551234",
      code: otp!.code,
    }).then((r) => r.json());

    const logoutBody = await postJson(
      `http://localhost:${port}/auth/logout`,
      {},
      { "x-session-id": verify.sessionId },
    ).then((r) => r.json());
    assertEquals(logoutBody, { ok: true });

    // Subsequent /me with the same session should now reject.
    const me = await fetch(`http://localhost:${port}/me`, {
      headers: { "x-session-id": verify.sessionId },
    });
    if (me.ok) {
      const body = await me.json();
      assert(
        !("phoneNumber" in body),
        "user payload must not be returned after logout",
      );
    } else {
      await drain(me);
    }
  });
});

Deno.test("auth e2e: logout without session id is a no-op { ok: true }", async () => {
  await withServer(async (port) => {
    const body = await postJson(`http://localhost:${port}/auth/logout`, {})
      .then((r) => r.json());
    assertEquals(body, { ok: true });
  });
});

Deno.test("auth e2e: verify-otp sets pm_session HTTP-only cookie alongside the JSON body", async () => {
  await withServer(async (port) => {
    await drain(
      await postJson(`http://localhost:${port}/auth/send-otp`, {
        phoneNumber: "+15125551234",
      }),
    );
    const otp = await new OtpStore().get("+15125551234");
    const res = await postJson(`http://localhost:${port}/auth/verify-otp`, {
      phoneNumber: "+15125551234",
      code: otp!.code,
    });

    const setCookie = res.headers.get("set-cookie");
    assert(setCookie, "Set-Cookie header should be present");
    assert(
      setCookie.includes("pm_session="),
      "cookie name should be pm_session",
    );
    assert(setCookie.includes("HttpOnly"), "cookie should be HttpOnly");
    assert(setCookie.includes("SameSite=Lax"), "cookie should be SameSite=Lax");

    const body = await res.json();
    assert(typeof body.sessionId === "string");
    // Cookie value matches body.sessionId.
    const cookieMatch = setCookie.match(/pm_session=([^;]+)/);
    assertEquals(decodeURIComponent(cookieMatch![1]), body.sessionId);
  });
});

Deno.test("auth e2e: a request authenticated by Cookie alone (no x-session-id) succeeds on a protected endpoint", async () => {
  await withServer(async (port) => {
    await drain(
      await postJson(`http://localhost:${port}/auth/send-otp`, {
        phoneNumber: "+15125551234",
      }),
    );
    const otp = await new OtpStore().get("+15125551234");
    const verify = await postJson(`http://localhost:${port}/auth/verify-otp`, {
      phoneNumber: "+15125551234",
      code: otp!.code,
    });
    const setCookie = verify.headers.get("set-cookie")!;
    await drain(verify);

    // Hit /me using ONLY the cookie — no x-session-id.
    const cookieValue = setCookie.split(";")[0]; // "pm_session=...."
    const me = await fetch(`http://localhost:${port}/me`, {
      headers: { cookie: cookieValue },
    }).then((r) => r.json());
    assert(typeof me.id === "string", "should resolve user via cookie");
  });
});

Deno.test("auth e2e: logout clears the pm_session cookie", async () => {
  await withServer(async (port) => {
    const res = await postJson(`http://localhost:${port}/auth/logout`, {});
    const setCookie = res.headers.get("set-cookie") ?? "";
    assert(setCookie.includes("pm_session="));
    assert(setCookie.includes("Max-Age=0"));
    await drain(res);
  });
});

// ── REQ-050: /login-internal — log in with email ────────────────────────────

/** A live account with `email` on file, created through the phone flow the
 *  way every real account is. Returns its session cookie + id. */
async function accountWithEmail(port: number, phone: string, email: string) {
  await drain(await postJson(`http://localhost:${port}/auth/send-otp`, { phoneNumber: phone }));
  const otp = await new OtpStore().get(phone);
  const verify = await postJson(`http://localhost:${port}/auth/verify-otp`, { phoneNumber: phone, code: otp!.code });
  const cookie = verify.headers.get("set-cookie")!.split(";")[0];
  const { userId } = await verify.json();
  const put = await fetch(`http://localhost:${port}/me`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ email }),
  });
  await drain(put);
  return { cookie, userId: userId as string };
}

Deno.test("REQ-050 auth e2e: send-email-otp → verify-email-otp opens the session of the account with that email (cookie + redirectTo)", async () => {
  await withServer(async (port) => {
    const { userId } = await accountWithEmail(port, "+15125550970", "Raphael@Example.com");

    const sent = await postJson(`http://localhost:${port}/auth/send-email-otp`, { email: " raphael@example.COM ", language: "en" });
    assertEquals(sent.status, 200);
    assertEquals(await sent.json(), { sent: true });

    const otp = await new OtpStore().get("email:raphael@example.com");
    assert(otp && /^\d{6}$/.test(otp.code), "a 6-digit code is pending under the email key");

    const verify = await postJson(`http://localhost:${port}/auth/verify-email-otp`, { email: "raphael@example.com", code: otp.code });
    assertEquals(verify.status, 200);
    const setCookie = verify.headers.get("set-cookie") ?? "";
    assert(setCookie.startsWith("pm_session="), "the session cookie is set");
    const body = await verify.json();
    assertEquals(body.ok, true);
    assertEquals(body.userId, userId);
    assertEquals(body.isNewUser, false);
    assertEquals(body.redirectTo, "/dashboard?welcome=back");
    assertEquals(await new OtpStore().get("email:raphael@example.com"), null, "the code is single-use");

    const me = await fetch(`http://localhost:${port}/me`, { headers: { cookie: setCookie.split(";")[0] } }).then((r) => r.json());
    assertEquals(me.id, userId);
  });
});

Deno.test("REQ-050 auth e2e: an email no account has yet — rafac@monsterrg.com — just creates the account and signs it in (/welcome)", async () => {
  await withServer(async (port) => {
    const sent = await postJson(`http://localhost:${port}/auth/send-email-otp`, { email: "rafac@monsterrg.com", language: "en" });
    assertEquals(sent.status, 200);
    assertEquals(await sent.json(), { sent: true });

    const otp = await new OtpStore().get("email:rafac@monsterrg.com");
    const verify = await postJson(`http://localhost:${port}/auth/verify-email-otp`, { email: "rafac@monsterrg.com", code: otp!.code });
    assertEquals(verify.status, 200);
    const setCookie = verify.headers.get("set-cookie") ?? "";
    assert(setCookie.startsWith("pm_session="), "the session cookie is set");
    const body = await verify.json();
    assertEquals(body.ok, true);
    assertEquals(body.isNewUser, true);
    assertEquals(body.redirectTo, "/welcome");

    const me = await fetch(`http://localhost:${port}/me`, { headers: { cookie: setCookie.split(";")[0] } }).then((r) => r.json());
    assertEquals(me.id, body.userId);
    assertEquals(me.email, "rafac@monsterrg.com");
    assertEquals(me.phoneNumber, "", "an email-born account has no phone yet");
  });
});

Deno.test("REQ-050 auth e2e: a malformed address is 400 invalid_email", async () => {
  await withServer(async (port) => {
    const sent = await postJson(`http://localhost:${port}/auth/send-email-otp`, { email: "not-an-address" });
    assertEquals(sent.status, 400);
    assertEquals(await sent.json(), { ok: false, error: "invalid_email" });
  });
});

Deno.test("REQ-050 auth e2e: a wrong code is 401 invalid_code; no code pending is 410 expired", async () => {
  await withServer(async (port) => {
    await accountWithEmail(port, "+15125550971", "wrong@example.com");
    const expired = await postJson(`http://localhost:${port}/auth/verify-email-otp`, { email: "wrong@example.com", code: "123456" });
    assertEquals(expired.status, 410);
    assertEquals(await expired.json(), { ok: false, error: "expired" });

    await drain(await postJson(`http://localhost:${port}/auth/send-email-otp`, { email: "wrong@example.com" }));
    const real = (await new OtpStore().get("email:wrong@example.com"))!.code;
    const wrong = real === "111111" ? "222222" : "111111";
    const res = await postJson(`http://localhost:${port}/auth/verify-email-otp`, { email: "wrong@example.com", code: wrong });
    assertEquals(res.status, 401);
    assertEquals(await res.json(), { ok: false, error: "invalid_code" });
  });
});
