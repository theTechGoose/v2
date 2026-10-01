/**
 * REQ-050 — "/login-internal … log in with email": the emailed code opens a
 * session for the account that carries the address — and only that.
 */
import { assert, assertEquals, assertRejects } from "#std/assert";
import { VerifyEmailOtp } from "./mod.ts";
import { ClosedAccountError } from "@users/domain/coordinators/send-email-otp/mod.ts";
import {
  ExpiredCodeError,
  InvalidCodeError,
  RateLimitedError,
} from "@users/domain/coordinators/verify-otp/mod.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

async function fresh() {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const otps = new OtpStore();
  const users = new UserStore();
  const sessions = new SessionStore();
  return {
    otps,
    users,
    sessions,
    flow: new VerifyEmailOtp(otps, users, sessions),
  };
}

async function userWithEmail(users: UserStore, phone: string, email: string) {
  const u = await users.create({ phoneNumber: phone, language: "en" });
  return await users.update(u.id, { email });
}

Deno.test("REQ-050 verify-email-otp: the right code opens a session for the account with that email and clears the record", async () => {
  const { otps, users, sessions, flow } = await fresh();
  try {
    const u = await userWithEmail(users, "+15125550960", "Raphael@Example.com");
    await otps.put({
      phoneNumber: "email:raphael@example.com",
      code: "123456",
      language: "en",
    });

    const result = await flow.run({
      email: " RAPHAEL@example.com ",
      code: "123456",
    });
    assertEquals(result.userId, u.id);
    assertEquals(result.isNewUser, false);
    assertEquals((await sessions.get(result.sessionId))?.userId, u.id);
    assertEquals(await otps.get("email:raphael@example.com"), null);
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-050 verify-email-otp: a wrong code counts an attempt; the sixth try is rate-limited", async () => {
  const { otps, users, flow } = await fresh();
  try {
    await userWithEmail(users, "+15125550961", "five@example.com");
    await otps.put({ phoneNumber: "email:five@example.com", code: "123456" });
    for (let i = 0; i < 5; i++) {
      await assertRejects(
        () => flow.run({ email: "five@example.com", code: "111111" }),
        InvalidCodeError,
      );
    }
    assertEquals((await otps.get("email:five@example.com"))?.attempts, 5);
    await assertRejects(
      () => flow.run({ email: "five@example.com", code: "123456" }),
      RateLimitedError,
    );
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-050 verify-email-otp: no pending code is ExpiredCodeError", async () => {
  const { users, flow } = await fresh();
  try {
    await userWithEmail(users, "+15125550962", "late@example.com");
    await assertRejects(
      () => flow.run({ email: "late@example.com", code: "123456" }),
      ExpiredCodeError,
    );
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-050 verify-email-otp: an address no account has yet creates the account — the email, the OTP's language, a placeholder name, NO phone", async () => {
  const { otps, users, sessions, flow } = await fresh();
  try {
    await otps.put({
      phoneNumber: "email:rafac@monsterrg.com",
      code: "123456",
      language: "en",
    });
    const result = await flow.run({
      email: "Rafac@MonsterRG.com",
      code: "123456",
    });
    assertEquals(result.isNewUser, true);
    const user = await users.get(result.userId);
    assertEquals(user.email, "rafac@monsterrg.com");
    assertEquals(user.language, "en");
    assertEquals(user.name, "New user");
    assertEquals(
      user.phoneNumber,
      "",
      "no made-up phone — documents and alerts read this field",
    );
    assertEquals((await sessions.get(result.sessionId))?.userId, user.id);
    assertEquals((await users.findByEmail("rafac@monsterrg.com"))?.id, user.id);

    // The second sign-in finds that same account.
    await otps.put({
      phoneNumber: "email:rafac@monsterrg.com",
      code: "654321",
    });
    const again = await flow.run({
      email: "rafac@monsterrg.com",
      code: "654321",
    });
    assertEquals(again.userId, user.id);
    assertEquals(again.isNewUser, false);
    assert(
      await users.findByEmail("rafac@monsterrg.com"),
      "still one account on the address",
    );
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-050 verify-email-otp: off Deno Deploy the master code 000000 logs in without a record — the existing account, or a new one", async () => {
  const { users, sessions, flow } = await fresh();
  try {
    const u = await userWithEmail(users, "+15125550963", "dev@example.com");
    const result = await flow.run({ email: "dev@example.com", code: "000000" });
    assertEquals(result.userId, u.id);
    assertEquals(result.isNewUser, false);
    assertEquals((await sessions.get(result.sessionId))?.userId, u.id);

    const made = await flow.run({
      email: "brand-new@example.com",
      code: "000000",
    });
    assertEquals(made.isNewUser, true);
    assertEquals((await users.get(made.userId)).email, "brand-new@example.com");
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-050 verify-email-otp: a closed account is ClosedAccountError", async () => {
  const { otps, users, flow } = await fresh();
  try {
    const u = await userWithEmail(users, "+15125550964", "closed@example.com");
    await users.delete(u.id);
    await otps.put({ phoneNumber: "email:closed@example.com", code: "123456" });
    await assertRejects(
      () => flow.run({ email: "closed@example.com", code: "123456" }),
      ClosedAccountError,
    );
  } finally {
    await resetKv();
  }
});
