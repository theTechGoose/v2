/**
 * REQ-050 — "/login-internal … log in with email": the code goes to the
 * address on an EXISTING account, under the same OTP discipline as SMS.
 */
import { assert, assertEquals, assertRejects } from "#std/assert";
import { ClosedAccountError, InvalidEmailError, SendEmailOtp } from "./mod.ts";
import { SendOtpCooldownError } from "@users/domain/coordinators/send-otp/mod.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import type { SendEmailInput } from "@communication/domain/data/email-service/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

async function fresh() {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const otps = new OtpStore();
  const users = new UserStore();
  return { otps, users, flow: new SendEmailOtp(users, otps) };
}

/** A fake sender in place of Postmark: every send is captured, none goes out. */
function captureSends(flow: SendEmailOtp) {
  const sent: SendEmailInput[] = [];
  flow.email = {
    send(input: SendEmailInput) {
      sent.push(input);
      return Promise.resolve({ ok: true, messageId: "m-1" });
    },
  };
  return sent;
}

Deno.test("REQ-050 send-email-otp: the account with that email gets a 6-digit code, stored under email:<address>, mailed in its language", async () => {
  const { otps, users, flow } = await fresh();
  const sent = captureSends(flow);
  try {
    const u = await users.create({
      phoneNumber: "+15125550950",
      language: "en",
    });
    await users.update(u.id, { email: "Raphael@Example.com" });

    const result = await flow.run({
      email: "  raphael@example.COM ",
      language: "en",
    });
    assertEquals(result.sent, true);
    assertEquals(result.normalizedEmail, "raphael@example.com");

    const stored = await otps.get("email:raphael@example.com");
    assert(stored, "OTP record should exist under the email key");
    assert(/^\d{6}$/.test(stored.code), "code should be 6 digits");
    assertEquals(stored.language, "en");

    assertEquals(sent.length, 1);
    assertEquals(sent[0].to, "raphael@example.com");
    assert(sent[0].htmlBody.includes(stored.code), "the mail carries the code");
    assert(
      sent[0].subject.includes(stored.code),
      "the subject carries the code too",
    );
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-050 send-email-otp: an address no account has yet still gets a code — the account is made when it comes back", async () => {
  const { otps, flow } = await fresh();
  const sent = captureSends(flow);
  try {
    const result = await flow.run({
      email: "Rafac@MonsterRG.com",
      language: "en",
    });
    assertEquals(result, {
      sent: true,
      normalizedEmail: "rafac@monsterrg.com",
    });
    const stored = await otps.get("email:rafac@monsterrg.com");
    assert(
      stored && /^\d{6}$/.test(stored.code),
      "a code is pending for the new address",
    );
    assertEquals(sent.length, 1);
    assertEquals(sent[0].to, "rafac@monsterrg.com");
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-050 send-email-otp: a malformed address is InvalidEmailError", async () => {
  const { flow } = await fresh();
  try {
    await assertRejects(
      () => flow.run({ email: "not-an-address" }),
      InvalidEmailError,
    );
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-050 send-email-otp: a closed account is ClosedAccountError — no code goes out", async () => {
  const { otps, users, flow } = await fresh();
  try {
    const u = await users.create({ phoneNumber: "+15125550951" });
    await users.update(u.id, { email: "closed@example.com" });
    await users.delete(u.id);
    await assertRejects(
      () => flow.run({ email: "closed@example.com" }),
      ClosedAccountError,
    );
    assertEquals(await otps.get("email:closed@example.com"), null);
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-050 send-email-otp: a second send inside the 30s cooldown is refused like SMS", async () => {
  const { users, flow } = await fresh();
  try {
    const u = await users.create({ phoneNumber: "+15125550952" });
    await users.update(u.id, { email: "again@example.com" });
    await flow.run({ email: "again@example.com" });
    await assertRejects(
      () => flow.run({ email: "again@example.com" }),
      SendOtpCooldownError,
    );
  } finally {
    await resetKv();
  }
});
