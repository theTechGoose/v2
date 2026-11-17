/** REQ-899 — Twilio request signatures: HMAC-SHA1(authToken, url + sorted(k+v)), base64. */
import { assertEquals } from "#std/assert";
import { twilioSignature, verifyTwilioSignature } from "./mod.ts";

const authToken = "12345";
const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
const params = {
  CallSid: "CA1234567890ABCDE",
  Caller: "+12349013030",
  Digits: "1234",
  From: "+12349013030",
  To: "+18005551212",
};

Deno.test("REQ-899 twilioSignature: Twilio's published vector", async () => {
  assertEquals(await twilioSignature(authToken, url, params), "0/KCTR6DLpKmkAf8muzZqo1nDgQ=");
});

Deno.test("REQ-899 verifyTwilioSignature: the right signature passes, a tampered body or url fails, no header fails", async () => {
  const signature = "0/KCTR6DLpKmkAf8muzZqo1nDgQ=";
  assertEquals(await verifyTwilioSignature({ authToken, url, params, signature }), true);
  assertEquals(await verifyTwilioSignature({ authToken, url, params: { ...params, Digits: "9999" }, signature }), false);
  assertEquals(await verifyTwilioSignature({ authToken, url: url + "&x=1", params, signature }), false);
  assertEquals(await verifyTwilioSignature({ authToken, url, params, signature: null }), false);
  assertEquals(await verifyTwilioSignature({ authToken: "other", url, params, signature }), false);
});

Deno.test("REQ-899 twilioSignature: a GET (no params) signs the url alone; params sort by key", async () => {
  const a = await twilioSignature(authToken, "https://x.test/hook", {});
  const b = await twilioSignature(authToken, "https://x.test/hook", { b: "2", a: "1" });
  const c = await twilioSignature(authToken, "https://x.test/hook", { a: "1", b: "2" });
  assertEquals(b, c);
  assertEquals(a === b, false);
});
