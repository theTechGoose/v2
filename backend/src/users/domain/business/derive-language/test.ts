import { assertEquals } from "#std/assert";
import { deriveLanguageOnVerify } from "./mod.ts";
import type { User } from "@users/dto/user.ts";

const stub = (lang?: User["language"]): User => ({
  id: "u-1",
  phoneNumber: "+15125551234",
  language: lang,
  createdAt: "2026-04-26T00:00:00.000Z",
  updatedAt: "2026-04-26T00:00:00.000Z",
});

Deno.test("deriveLanguageOnVerify: new user inherits OTP language", () => {
  assertEquals(deriveLanguageOnVerify(null, "es"), "es");
});

Deno.test("deriveLanguageOnVerify: new user without OTP language defaults to 'es' (Spanish-first)", () => {
  assertEquals(deriveLanguageOnVerify(null, undefined), "es");
});

Deno.test("deriveLanguageOnVerify: existing user keeps their preference (es) regardless of OTP toggle (en)", () => {
  assertEquals(deriveLanguageOnVerify(stub("es"), "en"), "es");
});

Deno.test("deriveLanguageOnVerify: existing user keeps their preference (en) regardless of OTP toggle (es)", () => {
  assertEquals(deriveLanguageOnVerify(stub("en"), "es"), "en");
});

Deno.test("deriveLanguageOnVerify: existing user with no language stays unset even if OTP carried one", () => {
  // Settings page never set it; we don't auto-populate from a one-shot SMS toggle.
  assertEquals(deriveLanguageOnVerify(stub(undefined), "es"), undefined);
});

// REQ-590 (demo-loop cycle 4, M33): the language picked on /verify's EN | ES toggle rides verify-otp
// and wins over the one send-otp stored for a NEW account; an existing account keeps its own.
Deno.test("REQ-590 deriveLanguageOnVerify: a new user takes the language picked on /verify over the OTP record's", () => {
  assertEquals(deriveLanguageOnVerify(null, "en", "es"), "es");
  assertEquals(deriveLanguageOnVerify(null, "es", "en"), "en");
});

Deno.test("REQ-590 deriveLanguageOnVerify: with nothing picked on /verify a new user still takes the OTP record's", () => {
  assertEquals(deriveLanguageOnVerify(null, "en", undefined), "en");
});

Deno.test("REQ-590 deriveLanguageOnVerify: an existing user keeps their language whatever /verify picked", () => {
  assertEquals(deriveLanguageOnVerify(stub("en"), "en", "es"), "en");
});
