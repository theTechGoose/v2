import "#reflect-metadata";
import { assertEquals, assertRejects } from "#std/assert";
import type { ExecutionContext } from "#danet/core";
import { readSessionId, requireUser, UnauthorizedError } from "./auth-helpers.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

function ctxWith(headers: Record<string, string | undefined>): ExecutionContext {
  // Minimal stub — auth-helpers only ever calls `ctx.req.header(name)`.
  return {
    req: {
      header: (name: string) => headers[name.toLowerCase()] ?? headers[name],
    },
  } as unknown as ExecutionContext;
}

Deno.test("readSessionId: returns null when no header and no cookie", () => {
  const ctx = ctxWith({});
  assertEquals(readSessionId(ctx), null);
});

Deno.test("readSessionId: prefers x-session-id header over cookie", () => {
  const ctx = ctxWith({
    "x-session-id": "from-header",
    "cookie": "pm_session=from-cookie",
  });
  assertEquals(readSessionId(ctx), "from-header");
});

Deno.test("readSessionId: falls back to pm_session cookie when header absent", () => {
  const ctx = ctxWith({ "cookie": "pm_session=abc123" });
  assertEquals(readSessionId(ctx), "abc123");
});

Deno.test("readSessionId: parses pm_session when other cookies are present", () => {
  const ctx = ctxWith({
    "cookie": "theme=dark; pm_session=xyz789; lang=en",
  });
  assertEquals(readSessionId(ctx), "xyz789");
});

Deno.test("readSessionId: tolerates whitespace around cookie pairs", () => {
  const ctx = ctxWith({
    "cookie": "theme=dark;   pm_session=spaced  ;lang=en",
  });
  // trim() is applied per-pair, so leading and trailing whitespace
  // (including around the value) is stripped before the prefix match.
  assertEquals(readSessionId(ctx), "spaced");
});

Deno.test("readSessionId: returns null when cookie has no pm_session entry", () => {
  const ctx = ctxWith({ "cookie": "theme=dark; lang=en" });
  assertEquals(readSessionId(ctx), null);
});

Deno.test("readSessionId: decodes URI-encoded session value", () => {
  const ctx = ctxWith({
    "cookie": `pm_session=${encodeURIComponent("a/b+c=d")}`,
  });
  assertEquals(readSessionId(ctx), "a/b+c=d");
});

Deno.test("readSessionId: empty pm_session value yields empty string (not null)", () => {
  const ctx = ctxWith({ "cookie": "pm_session=" });
  // Empty string is a valid (if useless) parse result; downstream
  // requireUser will treat it as a missing session.
  assertEquals(readSessionId(ctx), "");
});

Deno.test("readSessionId: ignores cookie names that merely contain pm_session as substring", () => {
  // `startsWith` only matches "pm_session=" — "xpm_session=foo" must not match.
  const ctx = ctxWith({ "cookie": "xpm_session=foo" });
  assertEquals(readSessionId(ctx), null);
});

// ---- requireUser ----

async function setupKv(): Promise<{ sessions: SessionStore; users: UserStore }> {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  return { sessions: new SessionStore(), users: new UserStore() };
}

Deno.test("requireUser: throws UnauthorizedError when no session id in request", async () => {
  const { sessions, users } = await setupKv();
  await assertRejects(
    () => requireUser(ctxWith({}), sessions, users),
    UnauthorizedError,
  );
  await resetKv();
});

Deno.test("requireUser: throws UnauthorizedError when session id is unknown", async () => {
  const { sessions, users } = await setupKv();
  await assertRejects(
    () => requireUser(ctxWith({ "x-session-id": "no-such-session" }), sessions, users),
    UnauthorizedError,
  );
  await resetKv();
});

Deno.test("requireUser: throws UnauthorizedError when session points to deleted user", async () => {
  const { sessions, users } = await setupKv();
  const user = await users.create({ phoneNumber: "+15125551111" });
  const session = await sessions.create(user.id);
  await users.delete(user.id);                              // session lingers, user gone
  await assertRejects(
    () => requireUser(ctxWith({ "x-session-id": session.id }), sessions, users),
    UnauthorizedError,
  );
  await resetKv();
});

Deno.test("requireUser: returns the user when session is valid (header path)", async () => {
  const { sessions, users } = await setupKv();
  const user = await users.create({ phoneNumber: "+15125552222" });
  const session = await sessions.create(user.id);
  const got = await requireUser(ctxWith({ "x-session-id": session.id }), sessions, users);
  assertEquals(got.id, user.id);
  assertEquals(got.phoneNumber, "+15125552222");
  await resetKv();
});

Deno.test("requireUser: returns the user when session arrives via cookie", async () => {
  const { sessions, users } = await setupKv();
  const user = await users.create({ phoneNumber: "+15125553333" });
  const session = await sessions.create(user.id);
  const got = await requireUser(
    ctxWith({ "cookie": `pm_session=${session.id}` }),
    sessions, users,
  );
  assertEquals(got.id, user.id);
  await resetKv();
});

Deno.test("UnauthorizedError: has the expected name and message", () => {
  const err = new UnauthorizedError();
  assertEquals(err.name, "UnauthorizedError");
  assertEquals(err.message, "unauthorized");
});
