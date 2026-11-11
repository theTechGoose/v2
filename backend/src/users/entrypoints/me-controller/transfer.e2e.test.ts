import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { AccountAdminStore } from "@users/domain/data/account-admin-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

/** REQ-220 — POST /me/transfer/start + /me/transfer/confirm on the booted app. */
@Module({ imports: [UsersModule] })
class TestApp {}

const PORT = 9052;
const OLD = "+15125551234";
const NEW = "+18435550000";
const J = { "content-type": "application/json" };

async function withServer(fn: (base: string) => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    await fn(`http://localhost:${PORT}`);
  } finally {
    await server.stop();
    await resetKv();
  }
}

async function login(base: string, phoneNumber: string): Promise<{ sessionId: string; userId: string; isNewUser?: boolean }> {
  await (await fetch(`${base}/auth/send-otp`, { method: "POST", headers: J, body: JSON.stringify({ phoneNumber }) })).body?.cancel();
  const stored = await new OtpStore().get(phoneNumber);
  return await (await fetch(`${base}/auth/verify-otp`, {
    method: "POST",
    headers: J,
    body: JSON.stringify({ phoneNumber, code: stored!.code }),
  })).json();
}

function post(base: string, path: string, sessionId: string, body: unknown): Promise<Response> {
  return fetch(`${base}${path}`, { method: "POST", headers: { ...J, "x-session-id": sessionId }, body: JSON.stringify(body) });
}

Deno.test("REQ-220 e2e: start hands back the code off the real deploy; confirm moves the account, signs the old owner out, and the new number signs in to the same account", async () => {
  await withServer(async (base) => {
    const owner = await login(base, OLD);
    const start = await post(base, "/me/transfer/start", owner.sessionId, { phoneNumber: "(843) 555-0000" });
    assertEquals(start.status, 200);
    const started = await start.json();
    assertEquals(started.sent, true);
    assertEquals(started.phoneNumber, NEW);
    assert(/^\d{6}$/.test(started.devCode), "the fakes carry the code (REQ-082)");

    const confirm = await post(base, "/me/transfer/confirm", owner.sessionId, { code: started.devCode });
    assertEquals(confirm.status, 200);
    assert((confirm.headers.get("set-cookie") ?? "").includes("pm_session=;"), "the cookie is cleared");
    assertEquals(await confirm.json(), { ok: true, phoneNumber: NEW });

    const dead = await fetch(`${base}/me`, { headers: { "x-session-id": owner.sessionId } });
    assertEquals(dead.status, 401);
    await dead.body?.cancel();

    const next = await login(base, NEW);
    assertEquals(next.userId, owner.userId);
    assertEquals(next.isNewUser, false);
    const me = await (await fetch(`${base}/me`, { headers: { "x-session-id": next.sessionId } })).json();
    assertEquals(me.phoneNumber, NEW);

    const old = await login(base, OLD);
    assert(old.userId !== owner.userId, "the old number is a brand-new account");
    assertEquals(old.isNewUser, true);
  });
});

Deno.test("REQ-220 e2e: the refusals carry their status and error — same_number, phone_taken, bad_phone, cooldown, invalid_code, expired, no session", async () => {
  await withServer(async (base) => {
    const owner = await login(base, OLD);
    await login(base, "+17135550000");
    const expect = async (res: Response, status: number, error: string) => {
      assertEquals(res.status, status);
      assertEquals((await res.json()).error, error);
    };
    await expect(await post(base, "/me/transfer/confirm", owner.sessionId, { code: "123456" }), 410, "expired");
    await expect(await post(base, "/me/transfer/start", owner.sessionId, { phoneNumber: OLD }), 409, "same_number");
    await expect(await post(base, "/me/transfer/start", owner.sessionId, { phoneNumber: "+17135550000" }), 409, "phone_taken");
    await expect(await post(base, "/me/transfer/start", owner.sessionId, { phoneNumber: "12" }), 400, "bad_phone");
    await expect(await post(base, "/me/transfer/start", owner.sessionId, {}), 400, "bad_phone");
    const started = await (await post(base, "/me/transfer/start", owner.sessionId, { phoneNumber: NEW })).json();
    const again = await post(base, "/me/transfer/start", owner.sessionId, { phoneNumber: NEW });
    assert(Number(again.headers.get("retry-after")) > 0);
    await expect(again, 429, "cooldown");
    const wrong = started.devCode === "111111" ? "222222" : "111111";
    await expect(await post(base, "/me/transfer/confirm", owner.sessionId, { code: wrong }), 422, "invalid_code");
    const anon = await fetch(`${base}/me/transfer/start`, { method: "POST", headers: J, body: JSON.stringify({ phoneNumber: NEW }) });
    assertEquals(anon.status, 401);
    await anon.body?.cancel();
    const me = await (await fetch(`${base}/me`, { headers: { "x-session-id": owner.sessionId } })).json();
    assertEquals(me.phoneNumber, OLD);
  });
});

Deno.test("REQ-220 e2e: an admin acting for the account is refused — 403, nothing sent", async () => {
  await withServer(async (base) => {
    const owner = await login(base, OLD);
    await new AccountAdminStore().create({ userId: owner.userId, phoneNumber: "+12105550000" });
    const admin = await login(base, "+12105550000");
    assertEquals(admin.userId, owner.userId);
    const start = await post(base, "/me/transfer/start", admin.sessionId, { phoneNumber: NEW });
    assertEquals(start.status, 403);
    await start.body?.cancel();
    const confirm = await post(base, "/me/transfer/confirm", admin.sessionId, { code: "123456" });
    assertEquals(confirm.status, 403);
    await confirm.body?.cancel();
  });
});
