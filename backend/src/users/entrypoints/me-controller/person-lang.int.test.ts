/**
 * REQ-631 — "Language is per person." An invited editor acts in the owner's account (REQ-146/624)
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
import { NotificationStore } from "@communication/domain/data/notification-store/mod.ts";

@Module({ imports: [UsersModule, CommunicationModule] })
class TestApp {}
const PORT = 9197;
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

Deno.test("REQ-631 an editor switching to Español writes HER language: /me and /profile carry it on actor.language; the owner's record, /me and the business's customer language stay English", async () => {
  await withServer(async (call) => {
    const { owner, her } = await ownerAndEditor(call, "+15125553100", "+15125553101");
    const before = await call("GET", "/me", undefined, her.H);
    assertEquals(before.body.actor.language, "en", "her own language, from her sign-in");

    const put = await call("PUT", "/me", { language: "es" }, her.H);
    assertEquals(put.status, 200, JSON.stringify(put.body));
    assertEquals(put.body.actor.language, "es", "the reply is the /me view with her language");
    assertEquals(put.body.language, "en", "the account's (owner's) language is not hers");

    const herRec = await new UserStore().get(put.body.actor.id);
    assertEquals(herRec.language, "es", "written to her own record");
    const ownerRec = await new UserStore().get(owner.userId);
    assertEquals(ownerRec.language, "en", "the owner's record is untouched");

    assertEquals((await call("GET", "/me", undefined, her.H)).body.actor.language, "es");
    assertEquals((await call("GET", "/profile", undefined, her.H)).body.actor.language, "es");
    const ownerMe = await call("GET", "/me", undefined, owner.H);
    assertEquals(ownerMe.body.language, "en", "the owner's own session is still English");
    assertEquals(ownerMe.body.actor, undefined);

    const ident = await call("GET", "/profile/identity", undefined, owner.H);
    assertEquals(ident.body.commsLanguage, "en", "what the business sends its customers is unchanged");
  });
});

Deno.test("REQ-631 the owner's own toggle still writes the account (it is his own language); the editor's language is unaffected", async () => {
  await withServer(async (call) => {
    const { owner, her } = await ownerAndEditor(call, "+15125553110", "+15125553111");
    await call("PUT", "/me", { language: "es" }, her.H);
    const ownerPut = await call("PUT", "/me", { language: "es" }, owner.H);
    assertEquals(ownerPut.status, 200);
    assertEquals((await new UserStore().get(owner.userId)).language, "es");
    await call("PUT", "/me", { language: "en" }, owner.H);
    assertEquals((await new UserStore().get(owner.userId)).language, "en");
    assertEquals((await call("GET", "/me", undefined, her.H)).body.actor.language, "es", "hers stays hers");
  });
});

Deno.test("REQ-631 the sign-in code is texted in the PERSON's saved language when the page names none", async () => {
  await withServer(async (call, texts) => {
    const { her } = await ownerAndEditor(call, "+15125553120", "+15125553121");
    await call("PUT", "/me", { language: "es" }, her.H);
    texts.length = 0;
    await call("POST", "/auth/send-otp", { phoneNumber: "+15125553121" });
    assertEquals(texts.length, 1);
    assertEquals(texts[0].to, "+15125553121");
    const esBody = texts[0].body;
    texts.length = 0;
    await call("POST", "/auth/send-otp", { phoneNumber: "+15125553120" });
    const enBody = texts[0].body;
    const code = (s: string) => s.replace(/\d{6}/, "{code}");
    assertEquals(code(esBody).includes("{code}"), true);
    assertEquals(code(esBody) === code(enBody), false, `two languages: "${esBody}" vs "${enBody}"`);
    // the owner's text is the English one (the dictionaries decide the words)
    const en = JSON.parse(await Deno.readTextFile(new URL("../../../../../lang/en.json", import.meta.url)));
    const es = JSON.parse(await Deno.readTextFile(new URL("../../../../../lang/es.json", import.meta.url)));
    assertEquals(code(enBody), en["sms.otpCode"], "the owner's code: English");
    assertEquals(code(esBody), es["sms.otpCode"], "hers: Spanish");
  });
});

Deno.test("REQ-631 the in-app notification feed renders in the person's language: the editor reads Spanish, the owner English, the same rows", async () => {
  await withServer(async (call) => {
    const { owner, her } = await ownerAndEditor(call, "+15125553130", "+15125553131");
    await call("PUT", "/me", { language: "es" }, her.H);
    await new NotificationStore().create({
      userId: owner.userId,
      type: "quote_sent",
      title: "fallback",
      titleKey: "notify.fallbackClient",
    });
    const en = JSON.parse(await Deno.readTextFile(new URL("../../../../../lang/en.json", import.meta.url)));
    const es = JSON.parse(await Deno.readTextFile(new URL("../../../../../lang/es.json", import.meta.url)));
    const hers = await call("GET", "/notifications", undefined, her.H);
    assertEquals(hers.status, 200, JSON.stringify(hers.body));
    assertEquals(hers.body[0].title.toLowerCase(), es["notify.fallbackClient"].toLowerCase(), "hers: Spanish");
    const his = await call("GET", "/notifications", undefined, owner.H);
    assertEquals(his.body[0].title.toLowerCase(), en["notify.fallbackClient"].toLowerCase(), "his: English");
  });
});
