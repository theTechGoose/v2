/** REQ-918 — the module runs on the account's plain TWILIO_* settings when no COMMS_TWILIO_* is set */
import { assertEquals } from "#std/assert";
import { readCommsConfig } from "./mod.ts";

const read = (env: Record<string, string | undefined>) =>
  readCommsConfig((k) => env[k]);

Deno.test("REQ-918a no COMMS_TWILIO_* at all → the TWILIO_* trio, not dev mode", () => {
  const cfg = read({
    TWILIO_ACCOUNT_SID: "ACplain",
    TWILIO_AUTH_TOKEN: "tok-plain",
    TWILIO_FROM: "+18435550100",
  });
  assertEquals(cfg.devMode, false);
  assertEquals([cfg.accountSid, cfg.authToken, cfg.from], [
    "ACplain",
    "tok-plain",
    "+18435550100",
  ]);
});

Deno.test("REQ-918a TWILIO_PHONE_NUMBER stands in for TWILIO_FROM", () => {
  const cfg = read({
    TWILIO_ACCOUNT_SID: "ACplain",
    TWILIO_AUTH_TOKEN: "t",
    TWILIO_PHONE_NUMBER: "+18435550101",
  });
  assertEquals(cfg.from, "+18435550101");
});

Deno.test("REQ-918a COMMS_TWILIO_ACCOUNT_SID set → the COMMS trio only; the plain token is never mixed in", () => {
  const cfg = read({
    COMMS_TWILIO_ACCOUNT_SID: "ACcomms",
    TWILIO_ACCOUNT_SID: "ACplain",
    TWILIO_AUTH_TOKEN: "tok-plain",
    TWILIO_FROM: "+18435550100",
  });
  assertEquals(cfg.accountSid, "ACcomms");
  assertEquals(cfg.authToken, "");
  assertEquals(cfg.from, "");
});

Deno.test("REQ-918a dev mode only when neither SID exists", () => {
  assertEquals(read({}).devMode, true);
  assertEquals(read({ TWILIO_AUTH_TOKEN: "t" }).devMode, true);
  assertEquals(read({ TWILIO_ACCOUNT_SID: "ACplain" }).devMode, false);
});

Deno.test("REQ-920 the A2P settings: real Twilio hosts, the platform email, the gate on — each overridable", () => {
  const d = read({ COMMS_TWILIO_ACCOUNT_SID: "AC1" });
  assertEquals([
    d.trusthubBaseUrl,
    d.messagingBaseUrl,
    d.a2pEmail,
    d.a2pPrimaryProfileSid,
    d.a2pGate,
  ], [
    "https://trusthub.twilio.com",
    "https://messaging.twilio.com",
    "hello@documonster.com",
    "",
    true,
  ]);
  const o = read({
    COMMS_TRUSTHUB_BASE_URL: "http://127.0.0.1:9148/",
    COMMS_MESSAGING_BASE_URL: "http://127.0.0.1:9148",
    COMMS_A2P_EMAIL: "ops@example.com",
    COMMS_A2P_PRIMARY_PROFILE_SID: "BUprimary",
    COMMS_A2P_GATE: "off",
  });
  assertEquals([
    o.trusthubBaseUrl,
    o.messagingBaseUrl,
    o.a2pEmail,
    o.a2pPrimaryProfileSid,
    o.a2pGate,
  ], [
    "http://127.0.0.1:9148",
    "http://127.0.0.1:9148",
    "ops@example.com",
    "BUprimary",
    false,
  ]);
});
