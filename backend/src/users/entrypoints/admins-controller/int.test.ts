/**
 * REQ-146 — account admins over HTTP, in process on an in-memory KV: the owner
 * invites a phone, that phone's OTP sign-in acts for the owner, the owner-only
 * actions refuse the admin, the switcher moves between accounts, and a removal
 * cuts the acting session at once.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { DanetApplication, Module } from "#danet/core";
import { UsersModule } from "@users/mod-root.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { type SendSmsInput, SmsService } from "@users/domain/data/sms/mod.ts";

@Module({ imports: [UsersModule] })
class TestApp {}
const PORT = 9188;
const J = { "content-type": "application/json" };
// deno-lint-ignore no-explicit-any
type Res = { status: number; body: any; headers: Headers };
type Call = (
  method: string,
  path: string,
  body?: unknown,
  headers?: HeadersInit,
) => Promise<Res>;

async function withServer(
  fn: (call: Call, texts: SendSmsInput[]) => Promise<void>,
) {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  await resetKv();
  const app = new DanetApplication();
  await app.init(TestApp);
  const texts: SendSmsInput[] = [];
  app.get(SmsService).send = (input: SendSmsInput) => {
    texts.push(input);
    return Promise.resolve({ ok: true });
  };
  await app.listen(PORT);
  const call: Call = async (method, path, body, headers = {}) => {
    const r = await fetch(`http://localhost:${PORT}${path}`, {
      method,
      headers: { ...J, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch { /* raw */ }
    return { status: r.status, body: parsed, headers: r.headers };
  };
  try {
    await fn(call, texts);
  } finally {
    await app.close();
    await resetKv();
  }
}

/** a real OTP round trip: the code is read off the store, as the sms would carry it */
async function signIn(call: Call, phone: string) {
  await call("POST", "/auth/send-otp", { phoneNumber: phone });
  const stored = await new OtpStore().get(phone);
  return await call("POST", "/auth/verify", {
    phoneNumber: phone,
    code: stored!.code,
  });
}
const H = (sessionId: string) => ({ "x-session-id": sessionId });

Deno.test("REQ-146 the owner invites a phone: 201 and a text in the owner's language; own number 400, a duplicate 409, a bad phone 400; the list and the removal", async () => {
  await withServer(async (call, texts) => {
    const owner = await signIn(call, "+15125551500");
    const O = H(owner.body.sessionId);
    await call("PUT", "/me", { name: "Raphael", language: "en" }, O);
    await call("PUT", "/profile/identity", { businessName: "Monster RG" }, O);
    texts.length = 0;
    const made = await call("POST", "/me/admins", {
      phoneNumber: "(512) 555-1501",
      name: "Hans",
    }, O);
    assertEquals(made.status, 201, JSON.stringify(made.body));
    assertEquals(made.body.phoneNumber, "+15125551501");
    assertEquals(made.body.name, "Hans");
    assertEquals(
      made.body.userId,
      owner.body.userId,
      "the record is the owner's",
    );
    assertEquals(texts.length, 1, "one invite text");
    assertEquals(texts[0].to, "+15125551501");
    assert(
      texts[0].body.includes("Raphael") && texts[0].body.includes("editor"),
      texts[0].body,
    ); // REQ-191: "editor", not "admin"
    assertEquals(
      (await call("POST", "/me/admins", { phoneNumber: "5125551500" }, O))
        .status,
      400,
      "own number",
    );
    assertEquals(
      (await call("POST", "/me/admins", { phoneNumber: "512-555-1501" }, O))
        .status,
      409,
      "already invited",
    );
    assertEquals(
      (await call("POST", "/me/admins", { phoneNumber: "12" }, O)).status,
      400,
      "bad phone",
    );
    assertEquals(
      (await call("POST", "/me/admins", {}, O)).status,
      400,
      "no phone",
    );
    const list = await call("GET", "/me/admins", undefined, O);
    assertEquals(list.body.map((a: { phoneNumber: string }) => a.phoneNumber), [
      "+15125551501",
    ]);
    assertEquals(
      (await call("DELETE", `/me/admins/${made.body.id}`, undefined, O)).status,
      200,
    );
    assertEquals((await call("GET", "/me/admins", undefined, O)).body, []);
    assertEquals(
      (await call("DELETE", `/me/admins/${made.body.id}`, undefined, O)).status,
      404,
      "gone",
    );
    assertEquals((await call("GET", "/me/admins")).status, 401, "no session");
  });
});

Deno.test("REQ-146 the invited phone signs in and acts for the owner: /me and /profile are the owner's, isNewUser false; the owner-only actions are 403; /me/accounts; switch-account; a removal cuts the session", async () => {
  await withServer(async (call, texts) => {
    const owner = await signIn(call, "+15125551510");
    const O = H(owner.body.sessionId);
    await call("PUT", "/me", { name: "Raphael", language: "es" }, O);
    await call("PUT", "/profile/identity", { businessName: "Monster RG" }, O);
    const made = await call("POST", "/me/admins", {
      phoneNumber: "+15125551511",
      name: "Hans",
    }, O);
    assertEquals(made.status, 201);
    assert(
      texts.at(-1)!.body.includes("Raphael"),
      "the invite names the owner",
    );

    // the admin signs in with their OWN number — a brand-new person
    const admin = await signIn(call, "+15125551511");
    assertEquals(admin.status, 200, JSON.stringify(admin.body));
    assertEquals(admin.body.isNewUser, false, "an admin is not a sign-up");
    assertEquals(
      admin.body.userId,
      owner.body.userId,
      "the session is IN the owner's account",
    );
    const ownerAgain = await signIn(call, "+15125551510");
    assertEquals(
      admin.body.redirectTo,
      ownerAgain.body.redirectTo,
      "lands where the owner's own sign-in lands (the owner's profile)",
    );
    const A = H(admin.body.sessionId);
    const me = await call("GET", "/me", undefined, A);
    assertEquals(me.body.id, owner.body.userId);
    assertEquals(me.body.name, "Raphael");
    assertEquals(
      (await call("GET", "/profile/identity", undefined, A)).body.businessName,
      "Monster RG",
      "the owner's data",
    );
    // the owner-only actions
    assertEquals((await call("GET", "/me/wipe", undefined, A)).status, 403);
    assertEquals((await call("DELETE", "/me", undefined, A)).status, 403);
    assertEquals(
      (await call("POST", "/me/plan", { planId: "free" }, A)).status,
      403,
    );
    assertEquals(
      (await call("POST", "/me/admins", { phoneNumber: "+15125551512" }, A))
        .status,
      403,
    );
    assertEquals(
      (await call("DELETE", `/me/admins/${made.body.id}`, undefined, A)).status,
      403,
    );
    assertEquals(
      (await call("GET", "/me/wipe", undefined, A)).body.error,
      "acting_as_admin",
    );
    assertEquals(
      (await call("GET", "/me/admins", undefined, A)).body.length,
      1,
      "an admin can see who else is in",
    );
    // the accounts
    const accounts = await call("GET", "/me/accounts", undefined, A);
    assertEquals(accounts.status, 200);
    assertEquals(accounts.body.actor.phoneNumber, "+15125551511");
    assertEquals(accounts.body.actor.name, "Hans", "the invite's name");
    assertEquals(accounts.body.currentUserId, owner.body.userId);
    assertEquals(
      accounts.body.accounts.map((
        a: { role: string; label: string },
      ) => [a.role, a.label]),
      [["owner", "+15125551511"], ["admin", "Monster RG"]],
    );
    const own = await call("GET", "/me/accounts", undefined, O);
    assertEquals(own.body.accounts.map((a: { role: string }) => a.role), [
      "owner",
    ]);
    assertEquals(own.body.currentUserId, owner.body.userId);
    // switch to the admin's own account and back
    const selfId = accounts.body.actor.id;
    const sw = await call("POST", "/me/switch-account", { userId: selfId }, A);
    assertEquals(sw.status, 200, JSON.stringify(sw.body));
    assert(
      sw.headers.get("set-cookie")?.startsWith("pm_session="),
      "the cookie is swapped",
    );
    assertEquals(
      (await call("GET", "/me", undefined, A)).status,
      401,
      "the old session is gone",
    );
    const S = H(sw.body.sessionId);
    assertEquals(
      (await call("GET", "/me", undefined, S)).body.id,
      selfId,
      "now their own account",
    );
    assertEquals(
      (await call("GET", "/profile/identity", undefined, S)).body?.businessName,
      undefined,
      "nothing of the owner's here",
    );
    assertEquals(
      (await call("POST", "/me/switch-account", { userId: "nobody" }, S))
        .status,
      403,
    );
    const back = await call("POST", "/me/switch-account", {
      userId: owner.body.userId,
    }, S);
    assertEquals(back.status, 200);
    const B = H(back.body.sessionId);
    assertEquals(
      (await call("GET", "/me", undefined, B)).body.id,
      owner.body.userId,
    );
    // the owner removes the admin: the acting session dies at once; the next sign-in is their own account
    assertEquals(
      (await call("DELETE", `/me/admins/${made.body.id}`, undefined, O)).status,
      200,
    );
    assertEquals(
      (await call("GET", "/me", undefined, B)).status,
      401,
      "cut at once",
    );
    const again = await signIn(call, "+15125551511");
    assertEquals(again.body.userId, selfId, "their own account now");
    assertEquals(
      (await call("GET", "/me/accounts", undefined, H(again.body.sessionId)))
        .body.accounts.length,
      1,
    );
  });
});

Deno.test("REQ-146 the dev master code signs an admin into the owner's account too; several invites — the earliest wins", async () => {
  await withServer(async (call) => {
    const first = await signIn(call, "+15125551520");
    await call(
      "PUT",
      "/me",
      { name: "First Owner", language: "en" },
      H(first.body.sessionId),
    );
    const second = await signIn(call, "+15125551521");
    await call(
      "PUT",
      "/me",
      { name: "Second Owner", language: "en" },
      H(second.body.sessionId),
    );
    assertEquals(
      (await call(
        "POST",
        "/me/admins",
        { phoneNumber: "+15125551522" },
        H(first.body.sessionId),
      )).status,
      201,
    );
    assertEquals(
      (await call(
        "POST",
        "/me/admins",
        { phoneNumber: "+15125551522" },
        H(second.body.sessionId),
      )).status,
      201,
    );
    const admin = await call("POST", "/auth/verify", {
      phoneNumber: "+15125551522",
      code: "000000",
    });
    assertEquals(admin.status, 200);
    assertEquals(admin.body.userId, first.body.userId, "the earliest invite");
    const accounts =
      (await call("GET", "/me/accounts", undefined, H(admin.body.sessionId)))
        .body;
    assertEquals(accounts.accounts.map((a: { label: string }) => a.label), [
      "+15125551522",
      "First Owner",
      "Second Owner",
    ]);
  });
});
