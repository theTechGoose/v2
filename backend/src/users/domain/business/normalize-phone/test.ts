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

// REQ-030 (NW-25): isFictionalUsNumber is the pure predicate the customer
// SMS send path uses to refuse a fictional number BEFORE Twilio (which would
// answer 21211 and the contractor only saw a raw JSON blob). The reserved
// fictional block is 555-01XX; area code 555 is not assignable. The rest of
// the 555 exchange stays accepted (real 555-XXXX lines outside 01XX exist).
// normalizePhone itself — the login/OTP path — keeps accepting them: dev and
// test personas log in with 555 numbers under the master OTP.
Deno.test("REQ-030 NW-25 isFictionalUsNumber: the reserved 555-01XX block and area code 555", async () => {
  const { isFictionalUsNumber } = await import("./mod.ts");
  assertEquals(isFictionalUsNumber("+15125550100"), true);
  assertEquals(isFictionalUsNumber("+15125550123"), true);
  assertEquals(isFictionalUsNumber("+15555551234"), true);
});

Deno.test("REQ-030 NW-25 isFictionalUsNumber: a real exchange, a 555-6xxx line and a non-US number are not fictional", async () => {
  const { isFictionalUsNumber } = await import("./mod.ts");
  assertEquals(isFictionalUsNumber("+15126550123"), false);
  assertEquals(isFictionalUsNumber("+15125556252"), false);
  assertEquals(isFictionalUsNumber("+442079460958"), false);
});

Deno.test("REQ-030 NW-25 normalizePhone (login path) still normalizes a 555-01XX number — the guard lives on the send path", () => {
  assertEquals(normalizePhone("(512) 555-0123"), "+15125550123");
});
