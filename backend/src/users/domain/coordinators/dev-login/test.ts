import { assert, assertEquals, assertRejects } from "#std/assert";
import { resetKv } from "@core/data/kv/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import {
  DevLogin,
  DevLoginForbiddenError,
  DevLoginNoUserError,
} from "@users/domain/coordinators/dev-login/mod.ts";

const TOKEN = "dev-token-REQ130-abc123";

async function freshWorld() {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const sessions = new SessionStore();
  const users = new UserStore();
  return { dev: new DevLogin(sessions, users), sessions, users };
}

function withToken<T>(value: string | undefined, fn: () => Promise<T> | T) {
  const prev = Deno.env.get("DEV_LOGIN_TOKEN");
  value === undefined
    ? Deno.env.delete("DEV_LOGIN_TOKEN")
    : Deno.env.set("DEV_LOGIN_TOKEN", value);
  const restore = () =>
    prev === undefined
      ? Deno.env.delete("DEV_LOGIN_TOKEN")
      : Deno.env.set("DEV_LOGIN_TOKEN", prev);
  return Promise.resolve(fn()).finally(restore);
}

Deno.test("REQ-130 the gate is hard-closed when DEV_LOGIN_TOKEN is unset, even with a token presented", async () => {
  const { dev } = await freshWorld();
  await withToken(undefined, () => {
    assertEquals(dev.isAllowed(TOKEN), false);
    assertEquals(dev.isAllowed(""), false);
    assertEquals(dev.isAllowed(undefined), false);
  });
});

Deno.test("REQ-130 the gate rejects a wrong token and accepts only the exact one", async () => {
  const { dev } = await freshWorld();
  await withToken(TOKEN, () => {
    assertEquals(dev.isAllowed("wrong"), false);
    assertEquals(dev.isAllowed(TOKEN + "x"), false);
    assertEquals(dev.isAllowed(""), false);
    assertEquals(dev.isAllowed(TOKEN), true);
  });
});

Deno.test("REQ-130 with the token, byPhone mints a real session for the existing user (no OTP)", async () => {
  const { dev, sessions, users } = await freshWorld();
  const user = await users.create({
    phoneNumber: "+15125551301",
    language: "en",
    name: "Alex",
  });
  const { session, user: got } = await withToken(
    TOKEN,
    () => dev.byPhone("+1 (512) 555-1301", TOKEN),
  );
  assertEquals(got.id, user.id);
  const stored = await sessions.get(session.id);
  assert(stored, "the session is persisted");
  assertEquals(stored!.userId, user.id);
  assertEquals(
    stored!.impersonatorId,
    undefined,
    "a plain session, not an impersonation",
  );
});

Deno.test("REQ-130 byPhone is forbidden without the gate, and 404s a phone with no live user", async () => {
  const { dev, users } = await freshWorld();
  await withToken(
    undefined,
    () =>
      assertRejects(
        () => dev.byPhone("+15125551301", TOKEN),
        DevLoginForbiddenError,
      ),
  );
  await withToken(
    TOKEN,
    () =>
      assertRejects(
        () => dev.byPhone("+15125559999", TOKEN),
        DevLoginNoUserError,
      ),
  );
  // a closed account is refused too
  const closed = await users.create({
    phoneNumber: "+15125551302",
    language: "en",
    name: "Gone",
  });
  await users.delete(closed.id);
  await withToken(
    TOKEN,
    () =>
      assertRejects(
        () => dev.byPhone("+15125551302", TOKEN),
        DevLoginNoUserError,
      ),
  );
});
