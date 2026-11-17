/**
 * REQ-523 (demo-loop cycle 3, issue m16): pair 7 invited Carol Miller at
 * (512) 555-0199 — a fictional 555-01XX number — and /admins said "We texted
 * (512) 555-0199 an invite". AccountAdmins.invite dropped the text's result,
 * and in dev mode SmsService answered ok for any number anyway.
 *
 * Over HTTP, app booted, the REAL SmsService in dev mode (no
 * TWILIO_ACCOUNT_SID — what the demo ran on): the invite's answer says
 * whether the text went out (`texted`), so the page can tell the owner.
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

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

Deno.test("REQ-523 (m16) an editor invite to a fictional 555-01XX number answers texted:false; a real number answers texted:true", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const owner = "+15125552301";
    await call("POST", "/auth/send-otp", { phoneNumber: owner });
    const code = (await new OtpStore().get(owner))!.code;
    const v = await call("POST", "/auth/verify-otp", {
      phoneNumber: owner,
      code,
    });
    const O = { "x-session-id": v.body.sessionId as string };
    await call("PUT", "/me", { name: "Hank Miller", language: "en" }, O);

    // pair 7's exact invite
    const carol = await call("POST", "/me/admins", {
      phoneNumber: "5125550199",
      name: "Carol Miller",
    }, O);
    assertEquals(carol.status, 201, JSON.stringify(carol.body));
    assertEquals(carol.body.phoneNumber, "+15125550199");
    assertEquals(
      carol.body.texted,
      false,
      "the invite claimed a text to a number that cannot get one",
    );

    const dana = await call("POST", "/me/admins", {
      phoneNumber: "(512) 555-2302",
      name: "Dana",
    }, O);
    assertEquals(dana.status, 201, JSON.stringify(dana.body));
    assertEquals(dana.body.texted, true, "a real number is texted");
  } finally {
    await server.stop();
    await resetKv();
  }
});
