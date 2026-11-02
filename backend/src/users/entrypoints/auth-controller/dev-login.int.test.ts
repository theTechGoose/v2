/**
 * REQ-130 — the developer-login service token. Presented with DEV_LOGIN_TOKEN
 * it opens a real session for an existing user over HTTP, skipping the OTP;
 * unset or wrong, the endpoint is closed.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { DanetApplication, Module } from "#danet/core";
import { UsersModule } from "@users/mod-root.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";

@Module({ imports: [UsersModule] })
class TestApp {}

const PORT = 9179;
const TOKEN = "dev-token-REQ130-int";

async function boot() {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const app = new DanetApplication();
  await app.init(TestApp);
  await app.listen(PORT);
  return app;
}

function post(body: unknown) {
  return fetch(`http://localhost:${PORT}/auth/dev-login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

Deno.test("REQ-130 dev-login opens a session for an existing user with the right token, and closes otherwise", async () => {
  const prev = Deno.env.get("DEV_LOGIN_TOKEN");
  const app = await boot();
  const user = await app.get(UserStore).create({
    phoneNumber: "+15125551300",
    language: "en",
    name: "Alex",
  });
  try {
    // closed when the env var is unset — even with a token in the body
    Deno.env.delete("DEV_LOGIN_TOKEN");
    let res = await post({ token: TOKEN, phoneNumber: "+15125551300" });
    assertEquals(
      res.status,
      403,
      "hard-closed when the server has no token set",
    );
    await res.body?.cancel();

    // with the server token set: a wrong token is still forbidden
    Deno.env.set("DEV_LOGIN_TOKEN", TOKEN);
    res = await post({ token: "wrong", phoneNumber: "+15125551300" });
    assertEquals(res.status, 403);
    await res.body?.cancel();

    // a good token for a phone nobody owns → 404
    res = await post({ token: TOKEN, phoneNumber: "+15125559999" });
    assertEquals(res.status, 404);
    await res.body?.cancel();

    // the real thing: a session + cookie for the existing user, no OTP
    res = await post({ token: TOKEN, phoneNumber: "+15125551300" });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.ok, true);
    assertEquals(body.userId, user.id);
    assert(typeof body.sessionId === "string" && body.sessionId.length > 0);
    const cookie = res.headers.get("set-cookie") ?? "";
    assert(cookie.includes("pm_session="), `cookie set: ${cookie}`);

    // and that session resolves to the user on a protected route
    const me = await fetch(`http://localhost:${PORT}/me`, {
      headers: { "x-session-id": body.sessionId },
    });
    assertEquals(me.status, 200);
    const meBody = await me.json();
    assertEquals(meBody.id, user.id);
  } finally {
    await app.close();
    prev === undefined
      ? Deno.env.delete("DEV_LOGIN_TOKEN")
      : Deno.env.set("DEV_LOGIN_TOKEN", prev);
    await resetKv();
  }
});
