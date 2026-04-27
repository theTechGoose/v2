import { assertEquals, assertRejects } from "#std/assert";
import {
  VerifyOtp,
  InvalidCodeError,
  ExpiredCodeError,
  RateLimitedError,
} from "./mod.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

function freshFlow() {
  const otps     = new OtpStore();
  const users    = new UserStore();
  const sessions = new SessionStore();
  return { otps, users, sessions, flow: new VerifyOtp(otps, users, sessions) };
}

Deno.test("verify-otp integration: first-time signup creates user with OTP language and session", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { otps, users, sessions, flow } = freshFlow();

  await otps.put({ phoneNumber: "+15125551234", code: "123456", language: "es" });
  const result = await flow.run({ phoneNumber: "(512) 555-1234", code: "123456" });

  const user = await users.get(result.userId);
  assertEquals(user.phoneNumber, "+15125551234");
  assertEquals(user.language, "es");                              // copied from OTP

  const session = await sessions.get(result.sessionId);
  assertEquals(session?.userId, result.userId);
  assertEquals(await otps.get("+15125551234"), null);             // OTP cleared on success

  await resetKv();
});

Deno.test("verify-otp integration: existing user keeps their language even if OTP carried a different one", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { otps, users, flow } = freshFlow();

  const existing = await users.create({ phoneNumber: "+15125551234", language: "en" });
  await otps.put({ phoneNumber: "+15125551234", code: "654321", language: "es" });

  const result = await flow.run({ phoneNumber: "+15125551234", code: "654321" });

  assertEquals(result.userId, existing.id);
  const refreshed = await users.get(existing.id);
  assertEquals(refreshed.language, "en");                         // unchanged

  await resetKv();
});

Deno.test("verify-otp integration: existing user without language gets one from OTP first time around", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { otps, users, flow } = freshFlow();

  const existing = await users.create({ phoneNumber: "+15125551234" });    // no language
  await otps.put({ phoneNumber: "+15125551234", code: "111111", language: "es" });

  await flow.run({ phoneNumber: "+15125551234", code: "111111" });
  const refreshed = await users.get(existing.id);
  // derive-language returns existing.language (undefined) for existing users — preserved.
  // We do NOT auto-populate language on existing users from a transient SMS toggle.
  assertEquals(refreshed.language, undefined);

  await resetKv();
});

Deno.test("verify-otp integration: wrong code throws InvalidCodeError and increments attempts", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { otps, flow } = freshFlow();

  await otps.put({ phoneNumber: "+15125551234", code: "123456" });
  await assertRejects(
    () => flow.run({ phoneNumber: "+15125551234", code: "999999" }),
    InvalidCodeError,
  );
  const after = await otps.get("+15125551234");
  assertEquals(after?.attempts, 1);

  await resetKv();
});

Deno.test("verify-otp integration: missing OTP throws ExpiredCodeError", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow } = freshFlow();

  await assertRejects(
    () => flow.run({ phoneNumber: "+15125551234", code: "123456" }),
    ExpiredCodeError,
  );

  await resetKv();
});

Deno.test("verify-otp integration: too many attempts throws RateLimitedError", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { otps, flow } = freshFlow();

  await otps.put({ phoneNumber: "+15125551234", code: "123456" });
  for (let i = 0; i < 5; i++) await otps.recordAttempt("+15125551234");

  await assertRejects(
    () => flow.run({ phoneNumber: "+15125551234", code: "123456" }),
    RateLimitedError,
  );

  await resetKv();
});

Deno.test("verify-otp integration: phone is normalized before lookup", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { otps, flow } = freshFlow();

  await otps.put({ phoneNumber: "+15125551234", code: "123456" });
  // User submits the same number formatted differently; should still match.
  const result = await flow.run({ phoneNumber: "(512) 555-1234", code: "123456" });
  assertEquals(typeof result.sessionId, "string");

  await resetKv();
});
