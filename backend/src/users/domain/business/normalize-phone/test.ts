import { assertEquals, assertThrows } from "#std/assert";
import { normalizePhone } from "./mod.ts";

Deno.test("normalizePhone: parenthesized 10-digit US number → E.164", () => {
  assertEquals(normalizePhone("(512) 555-1234"), "+15125551234");
});

Deno.test("normalizePhone: hyphenated 10-digit → E.164", () => {
  assertEquals(normalizePhone("512-555-1234"), "+15125551234");
});

Deno.test("normalizePhone: bare 10-digit → E.164", () => {
  assertEquals(normalizePhone("5125551234"), "+15125551234");
});

Deno.test("normalizePhone: 11-digit starting with 1 → E.164", () => {
  assertEquals(normalizePhone("15125551234"), "+15125551234");
});

Deno.test("normalizePhone: already E.164 with spaces → preserved", () => {
  assertEquals(normalizePhone("+1 512 555 1234"), "+15125551234");
});

Deno.test("normalizePhone: trims surrounding whitespace", () => {
  assertEquals(normalizePhone("  (512) 555-1234  "), "+15125551234");
});

Deno.test("normalizePhone: preserves non-US country code with leading +", () => {
  assertEquals(normalizePhone("+44 20 7946 0958"), "+442079460958");
});

Deno.test("normalizePhone: empty input throws", () => {
  assertThrows(() => normalizePhone(""));
});

Deno.test("normalizePhone: non-string throws", () => {
  assertThrows(() => normalizePhone(undefined as unknown as string));
});

Deno.test("normalizePhone: too short throws", () => {
  assertThrows(() => normalizePhone("12345"));
});

Deno.test("normalizePhone: too long throws", () => {
  assertThrows(() => normalizePhone("+1234567890123456"));
});
