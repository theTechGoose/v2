/**
 * REQ-624 — "When his daughter logs in she still sees Alexander's name." An editor invited to an
 * account signs in to an ACTING session (the account is the owner's, the person is hers). Over
 * HTTP, in process on an in-memory KV: /me, /profile and /me/accounts name HER (her own name,
 * else the invite's name for THIS account, else her phone) while the business stays the owner's;
 * PUT /me while acting writes her own record and never the owner's.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { DanetApplication, Module } from "#danet/core";
import { UsersModule } from "@users/mod-root.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { type SendSmsInput, SmsService } from "@users/domain/data/sms/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { AccountAdminStore } from "@users/domain/data/account-admin-store/mod.ts";

/** REQ-632 — the API now refuses a nameless invite; a LEGACY one (made before) is seeded as stored */
async function legacyInvite(ownerId: string, phoneNumber: string) {
  await new AccountAdminStore().create({ userId: ownerId, phoneNumber });
}

@Module({ imports: [UsersModule] })
class TestApp {}
const PORT = 9196;
const J = { "content-type": "application/json" };
// deno-lint-ignore no-explicit-any
type Res = { status: number; body: any };
type Call = (method: string, path: string, body?: unknown, headers?: HeadersInit) => Promise<Res>;

async function withServer(fn: (call: Call) => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  await resetKv();
  const app = new DanetApplication();
  await app.init(TestApp);
  app.get(SmsService).send = (_: SendSmsInput) => Promise.resolve({ ok: true });
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
    return { status: r.status, body: parsed };
  };
  try {
    await fn(call);
  } finally {
    await app.close();
    await resetKv();
  }
}

async function signIn(call: Call, phone: string) {
  await call("POST", "/auth/send-otp", { phoneNumber: phone });
  const stored = await new OtpStore().get(phone);
  const r = await call("POST", "/auth/verify", { phoneNumber: phone, code: stored!.code });
  return { ...r.body, H: { "x-session-id": r.body.sessionId as string } };
}

async function ownerWithBusiness(call: Call, phone: string, name: string, biz: string) {
  const owner = await signIn(call, phone);
  await call("PUT", "/me", { name, language: "en" }, owner.H);
  await call("PUT", "/profile/identity", { businessName: biz }, owner.H);
  return owner;
}

Deno.test("REQ-624 an editor invited as \"Daughter Test\" signs in: /me, /profile and /me/accounts name her, the business stays the owner's; the owner's own session carries no actor", async () => {
  await withServer(async (call) => {
    const owner = await ownerWithBusiness(call, "+15125552400", "Alexander Jerez", "A2Z Landscape LLC");
    const invited = await call("POST", "/me/admins", { phoneNumber: "5125552401", name: "Daughter Test" }, owner.H);
    assertEquals(invited.status, 201, JSON.stringify(invited.body));

    const ownMe = await call("GET", "/me", undefined, owner.H);
    assertEquals(ownMe.body.name, "Alexander Jerez");
    assertEquals(ownMe.body.actor, undefined, "the owner's own session names the owner");

    const her = await signIn(call, "+15125552401");
    assertEquals(her.userId, owner.userId, "she acts in the owner's account");
    const me = await call("GET", "/me", undefined, her.H);
    assertEquals(me.status, 200);
    assertEquals(me.body.id, owner.userId, "the account is still the owner's");
    assert(me.body.actor.id && me.body.actor.id !== owner.userId, "the actor is her own user");
    assertEquals(me.body.actor.name, "Daughter Test");
    assertEquals(me.body.actor.needsName, false);
    assertEquals(me.body.actor.phoneNumber, "+15125552401", "her own number");

    const profile = await call("GET", "/profile", undefined, her.H);
    assertEquals(profile.body.actor.name, "Daughter Test");
    assertEquals(profile.body.initials, "DT", "the avatar is hers");
    assertEquals(profile.body.identity.businessName, "A2Z Landscape LLC", "the business is the owner's");

    const ownerProfile = await call("GET", "/profile", undefined, owner.H);
    assertEquals(ownerProfile.body.actor, undefined);
    assertEquals(ownerProfile.body.initials, "AJ");

    const accounts = await call("GET", "/me/accounts", undefined, her.H);
    assertEquals(accounts.body.actor.name, "Daughter Test");
  });
});

Deno.test("REQ-624 PUT /me while acting writes HER record: her name changes, the owner's never does", async () => {
  await withServer(async (call) => {
    const owner = await ownerWithBusiness(call, "+15125552410", "Alexander Jerez", "A2Z Landscape LLC");
    await call("POST", "/me/admins", { phoneNumber: "5125552411", name: "Daughter Test" }, owner.H);
    const her = await signIn(call, "+15125552411");

    const put = await call("PUT", "/me", { name: "Daughter Renamed", email: "daughter@example.com" }, her.H);
    assertEquals(put.status, 200, JSON.stringify(put.body));
    assertEquals(put.body.actor.name, "Daughter Renamed", "the reply is the /me view with her new name");
    assertEquals(put.body.name, "Alexander Jerez");

    const ownerRec = await new UserStore().get(owner.userId);
    assertEquals(ownerRec.name, "Alexander Jerez", "the owner is not renamed");
    assertEquals(ownerRec.email, undefined, "nor given her email");
    const herRec = await new UserStore().get(put.body.actor.id);
    assertEquals(herRec.name, "Daughter Renamed");
    assertEquals(herRec.email, "daughter@example.com");

    assertEquals((await call("GET", "/me", undefined, owner.H)).body.name, "Alexander Jerez");
    assertEquals((await call("GET", "/me", undefined, her.H)).body.actor.name, "Daughter Renamed");
  });
});

Deno.test("REQ-624/632 a LEGACY editor invite with no name: her phone, needsName true; once she names herself, that is her name everywhere", async () => {
  await withServer(async (call) => {
    const owner = await ownerWithBusiness(call, "+15125552420", "Alexander Jerez", "A2Z Landscape LLC");
    await legacyInvite(owner.userId, "+15125552421");
    const her = await signIn(call, "+15125552421");
    const me = await call("GET", "/me", undefined, her.H);
    assertEquals(me.body.actor.name, "(512) 555-2421", "never the owner's name");
    assertEquals(me.body.actor.needsName, true);
    const profile = await call("GET", "/profile", undefined, her.H);
    assertEquals(profile.body.actor.needsName, true);
    assert(profile.body.initials !== "AJ", `not the owner's initials (${profile.body.initials})`);

    await call("PUT", "/me", { name: "Sofia Jerez" }, her.H);
    const after = await call("GET", "/me", undefined, her.H);
    assertEquals(after.body.actor.name, "Sofia Jerez");
    assertEquals(after.body.actor.needsName, false);
    assertEquals((await call("GET", "/profile", undefined, her.H)).body.initials, "SJ");
    assertEquals((await new UserStore().get(owner.userId)).name, "Alexander Jerez");
  });
});

Deno.test("REQ-624 /me/accounts names her by THIS account's invite, not another account's", async () => {
  await withServer(async (call) => {
    const a = await ownerWithBusiness(call, "+15125552430", "Alexander Jerez", "A2Z Landscape LLC");
    const b = await ownerWithBusiness(call, "+15125552432", "Other Owner", "Other Co");
    // A invites first (no name) — her sign-in lands in A; B's invite names her "Cousin"
    await legacyInvite(a.userId, "+15125552431");
    await new Promise((r) => setTimeout(r, 5));
    await call("POST", "/me/admins", { phoneNumber: "5125552431", name: "Cousin" }, b.H);
    const her = await signIn(call, "+15125552431");
    assertEquals(her.userId, a.userId);
    const accounts = await call("GET", "/me/accounts", undefined, her.H);
    assertEquals(accounts.body.actor.name, "(512) 555-2431", "B's invite name is not this account's");
    assertEquals((await call("GET", "/me", undefined, her.H)).body.actor.name, "(512) 555-2431");
  });
});
