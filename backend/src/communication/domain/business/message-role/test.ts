import { assertEquals } from "#std/assert";
import { isFromAssistant, isFromUser, rolePrefix } from "./mod.ts";

Deno.test("isFromUser flags user role only", () => {
  assertEquals(isFromUser({ role: "user" }), true);
  assertEquals(isFromUser({ role: "assistant" }), false);
});

Deno.test("isFromAssistant flags assistant role only", () => {
  assertEquals(isFromAssistant({ role: "assistant" }), true);
  assertEquals(isFromAssistant({ role: "user" }), false);
});

Deno.test("rolePrefix maps each role to a short tag", () => {
  assertEquals(rolePrefix("user"), "U:");
  assertEquals(rolePrefix("assistant"), "A:");
  assertEquals(rolePrefix("system"), "S:");
});
