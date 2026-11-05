/**
 * REQ-151 — adding a worker texts the cell once: who added them, the /worker address and the
 * PIN, in the owner's language; the answer says `texted`; the PIN still never comes back in the
 * record (REQ-138). The SMS seam is the service's `send`, as the admin-invite test does.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { DanetApplication, Module } from "#danet/core";
import { FieldModule } from "@field/mod-root.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { type SendSmsInput, SmsService } from "@users/domain/data/sms/mod.ts";

@Module({ imports: [FieldModule] })
class TestApp {}
const PORT = 9189;
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
  fn: (
    call: Call,
    texts: SendSmsInput[],
    app: DanetApplication,
  ) => Promise<void>,
) {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  Deno.env.delete("DENO_DEPLOYMENT_ID");
  Deno.env.delete("APP_URL");
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
    await fn(call, texts, app);
  } finally {
    await app.close();
    await resetKv();
  }
}

async function login(call: Call, language: "en" | "es") {
  const phone = "+15125551450";
  await call("POST", "/auth/send-otp", { phoneNumber: phone });
  const stored = await new OtpStore().get(phone);
  const v = await call("POST", "/auth/verify-otp", {
    phoneNumber: phone,
    code: stored!.code,
  });
  const H = { "x-session-id": v.body.sessionId as string };
  await call("PUT", "/me", { name: "Raphael Castro", language }, H);
  return H;
}

Deno.test("REQ-151 adding a worker texts the cell once with the owner, the /worker address and the PIN; the answer says texted; the PIN never comes back", async () => {
  await withServer(async (call, texts) => {
    const H = await login(call, "en");
    texts.length = 0; // the OTP text
    const made = await call("POST", "/field/workers", {
      name: "Luis",
      phoneNumber: "843-555-0201",
      pin: "1234",
    }, H);
    assertEquals(made.status, 201);
    assertEquals(made.body.texted, true, "the answer says the text went out");
    assertEquals(
      "pin" in made.body,
      false,
      "the PIN never comes back in the record (REQ-138)",
    );
    assertEquals(texts.length, 1, "one welcome text");
    assertEquals(texts[0].to, "+18435550201");
    assertEquals(
      texts[0].body,
      "Raphael Castro added you as a worker on DocuMonster. Sign in at http://localhost:5280/worker with this number and your PIN 1234.",
    );
  });
});

Deno.test("REQ-151 a Spanish owner's worker is texted in Spanish; a refused add (a duplicate cell) texts nothing", async () => {
  await withServer(async (call, texts) => {
    const H = await login(call, "es");
    texts.length = 0;
    const made = await call("POST", "/field/workers", {
      name: "Marcos",
      phoneNumber: "8435550202",
      pin: "4321",
    }, H);
    assertEquals(made.status, 201);
    assertEquals(texts.length, 1);
    assert(
      texts[0].body.startsWith(
        "Raphael Castro te agregó como trabajador en DocuMonster. Entra en http://localhost:5280/worker",
      ),
      texts[0].body,
    );
    assert(texts[0].body.endsWith("tu PIN 4321."), texts[0].body);
    const dup = await call("POST", "/field/workers", {
      name: "Otro",
      phoneNumber: "8435550202",
      pin: "0000",
    }, H);
    assertEquals(dup.status, 409);
    assertEquals(texts.length, 1, "a refused add texts nothing");
  });
});

Deno.test("REQ-151 when the text cannot go out the worker is still added and the answer says texted: false", async () => {
  await withServer(async (call, texts, app) => {
    const H = await login(call, "en");
    texts.length = 0;
    app.get(SmsService).send = () =>
      Promise.resolve({ ok: false, reason: "unreachable" });
    const made = await call("POST", "/field/workers", {
      name: "Jorge",
      phoneNumber: "8435550203",
      pin: "1111",
    }, H);
    assertEquals(made.status, 201);
    assertEquals(made.body.texted, false);
    assertEquals(
      (await call("GET", "/field/workers", undefined, H)).body.map((
        w: { name: string },
      ) => w.name),
      ["Jorge"],
    );
  });
});
