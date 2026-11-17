/**
 * REQ-601 (demo-loop cycle 4, issue M12): pair 8 added a worker at a 555-01XX
 * number; the welcome text could not go (REQ-523) and /field/workers said
 * "We couldn't text {name} — share the link and PIN yourself." — but the page
 * had no link to share: the add's answer carried only `texted`, and the form
 * had already wiped the PIN.
 *
 * Over HTTP, app booted, the REAL SmsService in dev mode: the add answers the
 * worker's sign-in address (`signInUrl`) and the exact welcome text the SMS
 * would have carried (`shareText`: who added them, the address, the PIN), so
 * the page can show and copy them when `texted` is false.
 */
import "#reflect-metadata";
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { FieldModule } from "@field/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import {
  workerSignInUrl,
  workerWelcome,
} from "@field/domain/business/worker-welcome/mod.ts";
import { appUrl } from "@users/domain/business/app-url/mod.ts";

@Module({ imports: [FieldModule] })
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

Deno.test("REQ-601 (cycle 4, M12) a worker add that could not be texted answers the sign-in link and the welcome text to share", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const owner = "+15125552321";
    await call("POST", "/auth/send-otp", { phoneNumber: owner });
    const code = (await new OtpStore().get(owner))!.code;
    const v = await call("POST", "/auth/verify-otp", {
      phoneNumber: owner,
      code,
    });
    const H = { "x-session-id": v.body.sessionId as string };
    await call("PUT", "/me", { name: "Hank Miller", language: "en" }, H);

    // pair 8's number: a reserved 555-01XX, never texted
    const made = await call("POST", "/field/workers", {
      name: "Luis Ortega",
      phoneNumber: "5125550188",
      pin: "4826",
      language: "es",
    }, H);
    assertEquals(made.status, 201, JSON.stringify(made.body));
    assertEquals(made.body.texted, false);
    const url = workerSignInUrl(appUrl(), "es");
    assertEquals(
      made.body.signInUrl,
      url,
      "the add answers the /worker address the text would have carried",
    );
    assert(
      typeof made.body.shareText === "string",
      "the add answers the welcome text to share",
    );
    assertEquals(
      made.body.shareText,
      workerWelcome("es", { owner: "Hank Miller", url, pin: "4826" }),
      "the shared text is the welcome SMS, word for word, in the worker's language",
    );
    assertStringIncludes(made.body.shareText, "4826");
    assertEquals(made.body.pin, undefined, "the worker record stays PIN-free");
  } finally {
    await server.stop();
    await resetKv();
  }
});
