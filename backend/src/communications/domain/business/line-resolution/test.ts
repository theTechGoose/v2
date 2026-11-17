/** REQ-904 — which line a request belongs to. */
import { assertEquals } from "#std/assert";
import {
  lineRefForWebhook,
  ownsEnvLine,
  resolvedFromLine,
  webhookTo,
} from "./mod.ts";
import type { Line } from "@communications/dto/mod.ts";
import { configFromEnv } from "@communications/domain/data/config/mod.ts";

Deno.test("REQ-904 lineRefForWebhook: main account → env line, anything else → that subaccount, missing → unknown", () => {
  assertEquals(lineRefForWebhook("ACmain", { AccountSid: "ACmain" }), {
    kind: "env",
  });
  assertEquals(lineRefForWebhook("ACmain", { AccountSid: "ACsub1" }), {
    kind: "subaccount",
    subaccountSid: "ACsub1",
  });
  assertEquals(lineRefForWebhook("ACmain", {}), { kind: "unknown" });
  assertEquals(lineRefForWebhook("", { AccountSid: "" }), { kind: "unknown" });
});

Deno.test("REQ-904 ownsEnvLine: only the configured owner, and only when an env line exists", () => {
  assertEquals(
    ownsEnvLine("u1", { from: "+18432588463", envLineOwner: "u1" }),
    true,
  );
  assertEquals(
    ownsEnvLine("u2", { from: "+18432588463", envLineOwner: "u1" }),
    false,
  );
  assertEquals(ownsEnvLine("u1", { from: "", envLineOwner: "u1" }), false);
  assertEquals(
    ownsEnvLine("u1", { from: "+18432588463", envLineOwner: "" }),
    false,
  );
});

const BASE: Line = {
  id: "l1",
  userId: "u1",
  kind: "subaccount",
  subaccountSid: "ACsub1",
  number: "+18435550100",
  numberSid: "PN1",
  apiKeySid: "SKsub",
  twimlAppSid: "APsub",
  status: "active",
  authTokenSealed: "x",
  apiKeySecretSealed: "y",
  createdAt: "2026-11-17T00:00:00Z",
  updatedAt: "2026-11-17T00:00:00Z",
};
const CFG = configFromEnv({
  COMMS_TWILIO_ACCOUNT_SID: "ACmain",
  COMMS_TWILIO_AUTH_TOKEN: "main-token",
  COMMS_TWILIO_FROM: "+18432588463",
}).get();

Deno.test("REQ-920b resolvedFromLine: a line moved to the main account runs on the main credentials with its own key", () => {
  const sub = resolvedFromLine(BASE, {
    authToken: "sub-token",
    apiKeySecret: "s1",
  }, CFG);
  assertEquals([sub.kind, sub.accountSid, sub.authToken, sub.apiKeySid], [
    "subaccount",
    "ACsub1",
    "sub-token",
    "SKsub",
  ]);
  const main = resolvedFromLine(
    {
      ...BASE,
      kind: "main",
      subaccountSid: "",
      apiKeySid: "SKmain",
      twimlAppSid: "APmain",
      messagingServiceSid: "MGsupport",
      campaignUsecase: "CUSTOMER_CARE",
    },
    { authToken: "", apiKeySecret: "s2" },
    CFG,
  );
  assertEquals([
    main.kind,
    main.accountSid,
    main.authToken,
    main.apiKeySid,
    main.twimlAppSid,
    main.apiKeySecret,
  ], ["main", "ACmain", "main-token", "SKmain", "APmain", "s2"]);
  assertEquals(main.ringIdentities, ["u1"]);
});

Deno.test("REQ-920b webhookTo: the number Twilio delivered to (To, else Called), E.164 or ''", () => {
  assertEquals(webhookTo({ To: "+18435550100" }), "+18435550100");
  assertEquals(webhookTo({ Called: "+18435550100" }), "+18435550100");
  assertEquals(webhookTo({ To: "client:abc" }), "");
  assertEquals(webhookTo({}), "");
});
