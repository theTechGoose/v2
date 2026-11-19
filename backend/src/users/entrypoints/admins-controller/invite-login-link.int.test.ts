/**
 * REQ-1061 (LOOP-007 cycle 2, q2-49) — amends REQ-146 / REQ-601: over HTTP,
 * app booted on an in-memory KV, the SMS captured off the SmsService seam.
 * POST /me/admins texts the invitee `<appUrl>/login?lang=<owner's language>`
 * and answers the same link as `signInUrl` — never the bare site root, which a
 * signed-out invitee sees as the marketing page in her browser's language.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { DanetApplication, Module } from "#danet/core";
import { UsersModule } from "@users/mod-root.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { type SendSmsInput, SmsService } from "@users/domain/data/sms/mod.ts";
import { appUrl } from "@users/domain/business/app-url/mod.ts";

@Module({ imports: [UsersModule] })
class TestApp {}
const PORT = 40000 + Math.floor(Math.random() * 20000);
const J = { "content-type": "application/json" };

async function call(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
  // deno-lint-ignore no-explicit-any
): Promise<{ status: number; body: any }> {
  const r = await fetch(`http://localhost:${PORT}${path}`, {
    method,
    headers: { ...J, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}

for (
  const [lang, ownerPhone, invitee] of [
    ["en", "+15125552410", "5125552411"],
    ["es", "+15125552420", "5125552421"],
  ] as const
) {
  Deno.test(`REQ-1061 (LOOP-007 q2-49) POST /me/admins by an ${lang} owner texts and answers ${"<appUrl>"}/login?lang=${lang}`, async () => {
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
    try {
      await call("POST", "/auth/send-otp", { phoneNumber: ownerPhone });
      const code = (await new OtpStore().get(ownerPhone))!.code;
      const v = await call("POST", "/auth/verify", {
        phoneNumber: ownerPhone,
        code,
      });
      const O = { "x-session-id": v.body.sessionId as string };
      await call("PUT", "/me", { name: "Dana Ruiz", language: lang }, O);
      texts.length = 0;

      const made = await call("POST", "/me/admins", {
        phoneNumber: invitee,
        name: "Carol Miller",
      }, O);
      assertEquals(made.status, 201, JSON.stringify(made.body));
      const want = `${appUrl()}/login?lang=${lang}`;
      assertEquals(texts.length, 1, "one invite text");
      assert(
        texts[0].body.includes(want),
        `the invite SMS carries ${want} (got "${texts[0].body}")`,
      );
      assertEquals(
        made.body.signInUrl,
        want,
        "signInUrl (the /admins share block) is the same sign-in link",
      );
    } finally {
      await app.close();
      await resetKv();
    }
  });
}
