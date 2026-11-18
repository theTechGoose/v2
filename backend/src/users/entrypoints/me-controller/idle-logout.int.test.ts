/**
 * REQ-929 — "an inactivity timer … logs the user out". PUT /me { idleLogoutMinutes } stores the
 * person's own sign-out-after-inactivity minutes (one of 0/15/30/60/120/240, else a 400); while
 * acting it is HER record, never the owner's, and /me + /profile carry it on actor.idleLogoutMinutes.
 *
 * (harness copied from person-lang.int.test.ts — REQ-631 — "Language is per person." An invited editor acts in the owner's account (REQ-146/624)
 * but the language is HERS: PUT /me { language } while acting writes her own record, never the
 * owner's; /me and /profile carry it on `actor.language`; the app's own messages to her (the
 * sign-in code, the in-app notification feed) speak it. What the business sends its customers
 * (the business identity's commsLanguage, the owner's own record) is untouched.
 * In process on an in-memory KV.
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { DanetApplication, Module } from "#danet/core";
import { UsersModule } from "@users/mod-root.ts";
import { CommunicationModule } from "@communication/mod-root.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { type SendSmsInput, SmsService } from "@users/domain/data/sms/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";

@Module({ imports: [UsersModule, CommunicationModule] })
class TestApp {}
const PORT = 9939;
const J = { "content-type": "application/json" };
// deno-lint-ignore no-explicit-any
type Res = { status: number; body: any };
type Call = (method: string, path: string, body?: unknown, headers?: HeadersInit) => Promise<Res>;

async function withServer(fn: (call: Call, texts: SendSmsInput[]) => Promise<void>) {
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
    return { status: r.status, body: parsed };
  };
  try {
    await fn(call, texts);
  } finally {
    await app.close();
    await resetKv();
  }
}

async function signIn(call: Call, phone: string, language?: "en" | "es") {
  await call("POST", "/auth/send-otp", { phoneNumber: phone, ...(language ? { language } : {}) });
  const stored = await new OtpStore().get(phone);
  const r = await call("POST", "/auth/verify", { phoneNumber: phone, code: stored!.code });
  return { ...r.body, H: { "x-session-id": r.body.sessionId as string } };
}

/** the A2Z set-up: an English owner whose customers get English, and his editor */
async function ownerAndEditor(call: Call, ownerPhone: string, herPhone: string) {
  const owner = await signIn(call, ownerPhone, "en");
  await call("PUT", "/me", { name: "Alexander Jerez", language: "en" }, owner.H);
  await call("PUT", "/profile/identity", { businessName: "A2Z Landscape LLC", commsLanguage: "en" }, owner.H);
  const inv = await call("POST", "/me/admins", { phoneNumber: herPhone, name: "Daughter Test" }, owner.H);
  assertEquals(inv.status, 201, JSON.stringify(inv.body));
  const her = await signIn(call, herPhone, "en");
  assertEquals(her.userId, owner.userId, "she acts in the owner's account");
  return { owner, her };
}


Deno.test("REQ-929 PUT /me { idleLogoutMinutes } stores the owner's choice; /me and /profile read it back; 0 turns it off", async () => {
  await withServer(async (call) => {
    const owner = await signIn(call, "+15125553900", "en");
    assertEquals((await call("GET", "/me", undefined, owner.H)).body.idleLogoutMinutes, undefined, "unset: Never");
    const put = await call("PUT", "/me", { idleLogoutMinutes: 30 }, owner.H);
    assertEquals(put.status, 200, JSON.stringify(put.body));
    assertEquals(put.body.idleLogoutMinutes, 30);
    assertEquals((await new UserStore().get(owner.userId)).idleLogoutMinutes, 30);
    assertEquals((await call("GET", "/me", undefined, owner.H)).body.idleLogoutMinutes, 30);
    assertEquals((await call("GET", "/profile", undefined, owner.H)).body.user.idleLogoutMinutes, 30);
    const off = await call("PUT", "/me", { idleLogoutMinutes: 0 }, owner.H);
    assertEquals(off.body.idleLogoutMinutes, 0);
  });
});

Deno.test("REQ-929 anything but 0/15/30/60/120/240 is a 400 and nothing is stored", async () => {
  await withServer(async (call) => {
    const owner = await signIn(call, "+15125553910", "en");
    for (const bad of [45, -15, "30", 15.5, null]) {
      const r = await call("PUT", "/me", { idleLogoutMinutes: bad }, owner.H);
      assertEquals(r.status, 400, `${JSON.stringify(bad)} → ${r.status} ${JSON.stringify(r.body)}`);
    }
    assertEquals((await new UserStore().get(owner.userId)).idleLogoutMinutes, undefined);
  });
});

Deno.test("REQ-929 an editor's choice is HERS: written to her record, on actor.idleLogoutMinutes; the owner's stays unset", async () => {
  await withServer(async (call) => {
    const { owner, her } = await ownerAndEditor(call, "+15125553920", "+15125553921");
    const put = await call("PUT", "/me", { idleLogoutMinutes: 15 }, her.H);
    assertEquals(put.status, 200, JSON.stringify(put.body));
    assertEquals(put.body.actor.idleLogoutMinutes, 15);
    assertEquals(put.body.idleLogoutMinutes, undefined, "the account's (owner's) setting is not hers");
    assertEquals((await new UserStore().get(put.body.actor.id)).idleLogoutMinutes, 15);
    assertEquals((await new UserStore().get(owner.userId)).idleLogoutMinutes, undefined);
    assertEquals((await call("GET", "/me", undefined, her.H)).body.actor.idleLogoutMinutes, 15);
    assertEquals((await call("GET", "/profile", undefined, her.H)).body.actor.idleLogoutMinutes, 15);
  });
});
