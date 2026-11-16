/** REQ-899 — every Twilio webhook is refused unless Twilio signed it. */
import "#reflect-metadata";
import { assertEquals, assertRejects } from "#std/assert";
import { freshLine, signedRequest } from "../_test-support/mod.ts";
import { VerifyWebhook, WebhookForbiddenError } from "./mod.ts";

Deno.test("REQ-899 verify-webhook int: a signed request yields its form fields; unsigned, mis-signed or tampered → 403", async () => {
  const { restore, cfg } = await freshLine();
  try {
    const v = new VerifyWebhook(cfg);
    const params = { From: "+15125551234", To: "+18432588463", Body: "hi" };
    const ok = await v.verify(await signedRequest("/communications/twilio/sms", params));
    assertEquals(ok, params);
    await assertRejects(async () => v.verify(await signedRequest("/communications/twilio/sms", params, { sign: false })), WebhookForbiddenError);
    await assertRejects(async () => v.verify(await signedRequest("/communications/twilio/sms", params, { token: "someone-else" })), WebhookForbiddenError);
    const signedForOtherPath = await signedRequest("/communications/twilio/sms-status", params);
    const replayed = new Request("http://localhost:3000/communications/twilio/sms", { method: "POST", headers: signedForOtherPath.headers, body: await signedForOtherPath.text() });
    await assertRejects(() => v.verify(replayed), WebhookForbiddenError);
    assertEquals(new WebhookForbiddenError().status, 403);
  } finally {
    await restore();
  }
});

Deno.test("REQ-899 verify-webhook int: with no auth token configured nothing validates", async () => {
  const { restore, cfg } = await freshLine({ COMMS_TWILIO_AUTH_TOKEN: undefined });
  try {
    const v = new VerifyWebhook(cfg);
    await assertRejects(async () => v.verify(await signedRequest("/communications/twilio/sms", { A: "1" })), WebhookForbiddenError);
  } finally {
    await restore();
  }
});
