/**
 * REQ-601 (demo-loop cycle 4, issue M12, the /admins variant): an editor invite
 * to a number that cannot be texted said "Let them know yourself." with no
 * sign-in address on the page.
 *
 * Over HTTP, app booted, the REAL SmsService in dev mode: the invite answers
 * the sign-in address (`signInUrl`) and the exact invite text the SMS would
 * have carried (`shareText`), so the page can show and copy them.
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { t } from "@core/i18n/mod.ts";
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

Deno.test("REQ-601 (cycle 4, M12) an editor invite that could not be texted answers the sign-in link and the invite text to share", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const owner = "+15125552331";
    await call("POST", "/auth/send-otp", { phoneNumber: owner });
    const code = (await new OtpStore().get(owner))!.code;
    const v = await call("POST", "/auth/verify-otp", {
      phoneNumber: owner,
      code,
    });
    const O = { "x-session-id": v.body.sessionId as string };
    await call("PUT", "/me", { name: "Hank Miller", language: "en" }, O);

    const carol = await call("POST", "/me/admins", {
      phoneNumber: "5125550199",
      name: "Carol Miller",
    }, O);
    assertEquals(carol.status, 201, JSON.stringify(carol.body));
    assertEquals(carol.body.texted, false);
    assertEquals(carol.body.signInUrl, appUrl());
    assertEquals(
      carol.body.shareText,
      t("en", "sms.adminInvite", { owner: "Hank Miller", url: appUrl() }),
      "the shared text is the invite SMS, word for word",
    );
  } finally {
    await server.stop();
    await resetKv();
  }
});
