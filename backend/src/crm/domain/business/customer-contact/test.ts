import { assertEquals } from "#std/assert";
import { primaryChannel } from "./mod.ts";

Deno.test("primaryChannel: prefers email", () => {
  assertEquals(primaryChannel({ email: "x@y.z", phoneNumber: "555" }), "email");
});

Deno.test("primaryChannel: phone when no email", () => {
  assertEquals(primaryChannel({ phoneNumber: "555", address: "1 Main" }), "phone");
});

Deno.test("primaryChannel: mail when only address", () => {
  assertEquals(primaryChannel({ address: "1 Main" }), "mail");
});

Deno.test("primaryChannel: none when nothing", () => {
  assertEquals(primaryChannel({}), "none");
});
