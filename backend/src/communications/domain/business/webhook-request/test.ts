/** REQ-899 — rebuilding the request Twilio signed, behind a proxy. */
import { assertEquals } from "#std/assert";
import { mediaUrls, parseForm, signedUrl, webhookFromParts } from "./mod.ts";

Deno.test("REQ-899 signedUrl: the public origin replaces whatever host the proxy handed us; path and query survive", () => {
  assertEquals(
    signedUrl("https://api.documonster.com/", "http://0.0.0.0:3000/communications/twilio/sms?x=1"),
    "https://api.documonster.com/communications/twilio/sms?x=1",
  );
});

Deno.test("REQ-899 parseForm + mediaUrls: Twilio's urlencoded body, including MMS attachments", () => {
  const params = parseForm("From=%2B15125551234&To=%2B18432588463&Body=hi+there&NumMedia=2&MediaUrl0=https%3A%2F%2Fa%2F1&MediaUrl1=https%3A%2F%2Fa%2F2");
  assertEquals(params.From, "+15125551234");
  assertEquals(params.Body, "hi there");
  assertEquals(mediaUrls(params), ["https://a/1", "https://a/2"]);
  assertEquals(mediaUrls({}), []);
});

Deno.test("REQ-899 webhookFromParts: one signed-request shape for the verifier", () => {
  const w = webhookFromParts({
    authToken: "t",
    publicOrigin: "https://x.test",
    requestUrl: "http://localhost:9999/communications/twilio/sms",
    rawBody: "A=1&B=2",
    signature: "sig",
  });
  assertEquals(w, { authToken: "t", url: "https://x.test/communications/twilio/sms", params: { A: "1", B: "2" }, signature: "sig" });
});
