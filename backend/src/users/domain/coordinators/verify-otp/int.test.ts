import { assertEquals, assertRejects } from "#std/assert";
import {
  VerifyOtp,
  AccountClosedError,
  InvalidCodeError,
  ExpiredCodeError,
  RateLimitedError,
} from "./mod.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

function freshFlow() {
  const otps       = new OtpStore();
  const users      = new UserStore();
  const sessions   = new SessionStore();
  const identities = new BusinessIdentityStore();
  return { otps, users, sessions, identities, flow: new VerifyOtp(otps, users, sessions, identities) };
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

Deno.test("verify-otp integration: dev master OTP on a fresh phone creates a user with NO seeded defaults and reports isNewUser=true", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("DEV_MASTER_OTP_SEED_DEFAULTS");
  await resetKv();
  const { users, identities, flow } = freshFlow();

  const result = await flow.run({ phoneNumber: "+15125550999", code: "000000" });
  assertEquals(result.isNewUser, true);

  const user = await users.get(result.userId);
  // Gets the neutral placeholder name (so identity-dependent UI like the
  // sidebar's Settings entry point is reachable immediately), but must NOT
  // be the legacy auto-seeded "Dev User". Spanish-first → "Nuevo usuario".
  assertEquals(user.name, "Nuevo usuario");
  const biz = await identities.get(result.userId);
  // Must NOT be auto-seeded "Dev Business".
  assertEquals(biz, null);

  await resetKv();
});

Deno.test("verify-otp integration: dev master OTP on an EXISTING phone reports isNewUser=false", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("DEV_MASTER_OTP_SEED_DEFAULTS");
  await resetKv();
  const { users, flow } = freshFlow();

  await users.create({ phoneNumber: "+15125550888", language: "en" });
  const result = await flow.run({ phoneNumber: "+15125550888", code: "000000" });
  assertEquals(result.isNewUser, false);

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

// REQ-039 (NW-52, p58): a verified OTP on a phone that belongs to a CLOSED
// account never silently reopens it and never creates a duplicate — it hands
// back a recovery token so the person can choose.
Deno.test("REQ-039 NW-52 verify-otp: a deleted account is recoverable — no session, no new user", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { otps, users, flow } = freshFlow();
  const old = await users.create({ phoneNumber: "+15125551234", language: "en", name: "Old Owner" });
  await users.delete(old.id);
  await otps.put({ phoneNumber: "+15125551234", code: "222222", language: "en" });

  const err = await assertRejects(
    () => flow.run({ phoneNumber: "+15125551234", code: "222222" }),
    AccountClosedError,
  );
  assertEquals(err.userId, old.id);
  assertEquals(typeof err.recoveryToken, "string");
  // Nothing was created behind the person's back.
  const stillOld = await users.findByPhone("+15125551234");
  assertEquals(stillOld?.id, old.id);
  await resetKv();
});

// REQ-211 — the account born from a landing signup keeps where it came from (the page, the ad),
// stamped once at creation; an existing account is never re-stamped by a later login.
Deno.test("REQ-211 verify-otp integration: a brand-new user is born with the OTP record's origin; an existing user keeps theirs", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { otps, users, flow } = freshFlow();
  await otps.put({ phoneNumber: "+15125550211", code: "123456", language: "es", origin: { page: "/landing5", ad: "cumple" } });
  const born = await flow.run({ phoneNumber: "+15125550211", code: "123456" });
  assertEquals((await users.get(born.userId)).origin, { page: "/landing5", ad: "cumple" });
  // the same account logs in again from another page: the origin is the first one
  await otps.put({ phoneNumber: "+15125550211", code: "654321", language: "es", origin: { page: "/landing2" } });
  const again = await flow.run({ phoneNumber: "+15125550211", code: "654321" });
  assertEquals(again.userId, born.userId);
  assertEquals((await users.get(born.userId)).origin, { page: "/landing5", ad: "cumple" });
  // a signup that carried no origin: none on the account
  await otps.put({ phoneNumber: "+15125550212", code: "111111", language: "en" });
  const plain = await flow.run({ phoneNumber: "+15125550212", code: "111111" });
  assertEquals((await users.get(plain.userId)).origin, undefined);
  await resetKv();
});

/** REQ-286 — run `fn` with DENO_DEPLOY set and DENO_DEPLOYMENT_ID unset (the real adapters, off
 *  Deno Deploy: a self-hosted prod, or the house's PORT+DENO_DEPLOY host e2e lane), then restore. */
async function withDenoDeployOffDeploy(fn: () => Promise<void>) {
  const prev = { d: Deno.env.get("DENO_DEPLOY"), id: Deno.env.get("DENO_DEPLOYMENT_ID") };
  Deno.env.set("DENO_DEPLOY", "1");
  Deno.env.delete("DENO_DEPLOYMENT_ID");
  try {
    await fn();
  } finally {
    if (prev.d === undefined) Deno.env.delete("DENO_DEPLOY");
    else Deno.env.set("DENO_DEPLOY", prev.d);
    if (prev.id !== undefined) Deno.env.set("DENO_DEPLOYMENT_ID", prev.id);
  }
}

Deno.test("REQ-286 test-setup-claims-m1 verify-otp: with DENO_DEPLOY set off Deno Deploy, 000000 is NOT a master code — no user, no session", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { otps, users, flow } = freshFlow();
  try {
    await withDenoDeployOffDeploy(async () => {
      // A stranger's phone with no pending code: the master code must not find-or-create it.
      await assertRejects(
        () => flow.run({ phoneNumber: "+15125550777", code: "000000" }),
        ExpiredCodeError,
      );
      assertEquals(await users.findByPhone("+15125550777"), null);

      // An existing owner with a real pending code: 000000 is just a wrong code.
      await users.create({ phoneNumber: "+15125550778", language: "en" });
      await otps.put({ phoneNumber: "+15125550778", code: "424242" });
      await assertRejects(
        () => flow.run({ phoneNumber: "+15125550778", code: "000000" }),
        InvalidCodeError,
      );
      assertEquals((await otps.get("+15125550778"))?.attempts, 1);
    });
  } finally {
    await resetKv();
  }
});

// REQ-590 (demo-loop cycle 4, M33): the EN | ES toggle on /verify picks the account's language —
// CodeInput sends it with the code, and a NEW account is born in it over the OTP record's.
Deno.test("REQ-590 verify-otp integration: a new account takes the language picked on /verify over the one send-otp stored", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { otps, users, flow } = freshFlow();

  await otps.put({ phoneNumber: "+15125550590", code: "590590", language: "en" });
  const result = await flow.run({ phoneNumber: "+15125550590", code: "590590", language: "es" });

  const user = await users.get(result.userId);
  assertEquals(user.language, "es");
  assertEquals(result.isNewUser, true);

  await resetKv();
});

Deno.test("REQ-590 verify-otp integration: on the master-code path too a new account takes the language picked on /verify", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { otps, users, flow } = freshFlow();

  await otps.put({ phoneNumber: "+15125550591", code: "123123", language: "en" });
  const result = await flow.run({ phoneNumber: "+15125550591", code: "000000", language: "es" });

  const user = await users.get(result.userId);
  assertEquals(user.language, "es");

  await resetKv();
});

Deno.test("REQ-590 verify-otp integration: an existing account keeps its language whatever /verify picked", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { otps, users, flow } = freshFlow();

  const existing = await users.create({ phoneNumber: "+15125550592", language: "en" });
  await otps.put({ phoneNumber: "+15125550592", code: "592592", language: "en" });
  await flow.run({ phoneNumber: "+15125550592", code: "592592", language: "es" });

  assertEquals((await users.get(existing.id)).language, "en");

  await resetKv();
});
