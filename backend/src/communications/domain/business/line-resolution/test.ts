/** REQ-904 — which line a request belongs to. */
import { assertEquals } from "#std/assert";
import { lineRefForWebhook, ownsEnvLine } from "./mod.ts";

Deno.test("REQ-904 lineRefForWebhook: main account → env line, anything else → that subaccount, missing → unknown", () => {
  assertEquals(lineRefForWebhook("ACmain", { AccountSid: "ACmain" }), { kind: "env" });
  assertEquals(lineRefForWebhook("ACmain", { AccountSid: "ACsub1" }), { kind: "subaccount", subaccountSid: "ACsub1" });
  assertEquals(lineRefForWebhook("ACmain", {}), { kind: "unknown" });
  assertEquals(lineRefForWebhook("", { AccountSid: "" }), { kind: "unknown" });
});

Deno.test("REQ-904 ownsEnvLine: only the configured owner, and only when an env line exists", () => {
  assertEquals(ownsEnvLine("u1", { from: "+18432588463", envLineOwner: "u1" }), true);
  assertEquals(ownsEnvLine("u2", { from: "+18432588463", envLineOwner: "u1" }), false);
  assertEquals(ownsEnvLine("u1", { from: "", envLineOwner: "u1" }), false);
  assertEquals(ownsEnvLine("u1", { from: "+18432588463", envLineOwner: "" }), false);
});
