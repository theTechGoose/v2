import { assertEquals } from "#std/assert";
import { channelLabel, requiresAddress, supportsSubject } from "./mod.ts";

Deno.test("requiresAddress: email/text/phone need an address", () => {
  assertEquals(requiresAddress("email"), true);
  assertEquals(requiresAddress("text"), true);
  assertEquals(requiresAddress("phone"), true);
});

Deno.test("requiresAddress: web/in_person do not need an address", () => {
  assertEquals(requiresAddress("web"), false);
  assertEquals(requiresAddress("in_person"), false);
});

Deno.test("supportsSubject: only email", () => {
  assertEquals(supportsSubject("email"), true);
  assertEquals(supportsSubject("text"), false);
});

Deno.test("channelLabel: replaces in_person with two words", () => {
  assertEquals(channelLabel("in_person"), "in person");
  assertEquals(channelLabel("email"), "email");
});
