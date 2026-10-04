// REQ-063 — hans@documonster.com is always a super-admin: a read-time overlay by address, like
// the hardcoded phone's. Pure rule, no KV.
import { assertEquals } from "#std/assert";
import { isAlwaysSuperAdmin } from "./mod.ts";

Deno.test("REQ-063 user-store — hans@documonster.com is a super-admin by address, however it is typed", () => {
  assertEquals(isAlwaysSuperAdmin({ email: "hans@documonster.com" }), true);
  assertEquals(isAlwaysSuperAdmin({ email: "  Hans@DocuMonster.COM " }), true, "trimmed, case-insensitive");
  assertEquals(isAlwaysSuperAdmin({ email: "hans@documonster.com", phoneNumber: "" }), true, "an email-only account (REQ-050)");
});

Deno.test("REQ-063 user-store — any other address is not, and the hardcoded phone still is", () => {
  assertEquals(isAlwaysSuperAdmin({ email: "art@documonster.com" }), false);
  assertEquals(isAlwaysSuperAdmin({ email: "hans@documonster.co" }), false, "no prefix match");
  assertEquals(isAlwaysSuperAdmin({ email: "", phoneNumber: "+15125550100" }), false);
  assertEquals(isAlwaysSuperAdmin({}), false);
  assertEquals(isAlwaysSuperAdmin({ phoneNumber: "+18438557133" }), true, "the phone rule stands");
});
