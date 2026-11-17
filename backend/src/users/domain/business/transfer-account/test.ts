import { assertEquals } from "#std/assert";
import { ownSession, transferCheck } from "./mod.ts";

Deno.test("REQ-220 transferCheck: the owner's own number is refused", () => {
  assertEquals(transferCheck("+15125551234", "+15125551234", null), "same_number");
});

Deno.test("REQ-220 transferCheck: a number that already has an account is refused, open or closed", () => {
  assertEquals(transferCheck("+15125551234", "+18435550000", { id: "u2" }), "phone_taken");
  assertEquals(transferCheck("+15125551234", "+18435550000", { id: "u2", deletedAt: "2026-01-01" }), "phone_taken");
});

Deno.test("REQ-220 transferCheck: a free number passes — also for an account that has no phone yet", () => {
  assertEquals(transferCheck("+15125551234", "+18435550000", null), null);
  assertEquals(transferCheck("", "+18435550000", null), null);
});

Deno.test("REQ-220 ownSession: the owner's own sessions only — never an admin's or an impersonation", () => {
  assertEquals(ownSession({ userId: "u1" }, "u1"), true);
  assertEquals(ownSession({ userId: "u2" }, "u1"), false);
  assertEquals(ownSession({ userId: "u1", actorId: "a1" }, "u1"), false);
  assertEquals(ownSession({ userId: "u1", impersonatorId: "s1" }, "u1"), false);
});
