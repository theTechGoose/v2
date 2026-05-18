import { assert, assertEquals } from "#std/assert";
import { SendOtp } from "./mod.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

interface CapturedSms { to: string; body: string }

function freshFlow(): { otps: OtpStore; sms: SmsService; smsCalls: CapturedSms[]; flow: SendOtp } {
  const otps = new OtpStore();
  const sms  = new SmsService();
  const smsCalls: CapturedSms[] = [];
  // Stub the SMS dispatcher with a synchronous capture; SmsService's
  // dev-mode would also work but capturing the body lets us assert
  // language-aware copy below.
  // deno-lint-ignore require-await
  sms.send = async (input) => { smsCalls.push(input); return { ok: true, reason: "test_capture" }; };
  return { otps, sms, smsCalls, flow: new SendOtp(otps, sms) };
}

Deno.test("send-otp integration: normalizes phone, generates code, persists OTP record, dispatches SMS", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { otps, smsCalls, flow } = freshFlow();

  const result = await flow.run({ phoneNumber: "(512) 555-1234", language: "es" });
  assertEquals(result.sent, true);
  assertEquals(result.normalizedPhone, "+15125551234");
  assert(/^\d{6}$/.test(result.codeForDispatch));

  const stored = await otps.get("+15125551234");
  assertEquals(stored?.code, result.codeForDispatch);
  assertEquals(stored?.language, "es");

  // SMS dispatch happened with localized Spanish copy.
  assertEquals(smsCalls.length, 1);
  assertEquals(smsCalls[0].to, "+15125551234");
  assert(smsCalls[0].body.startsWith("Tu código"), `expected Spanish copy, got: ${smsCalls[0].body}`);
  assert(smsCalls[0].body.includes(result.codeForDispatch));
  await resetKv();
});

Deno.test("send-otp integration: defaults to English copy when language omitted", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { smsCalls, flow } = freshFlow();
  await flow.run({ phoneNumber: "+15125551234" });
  assert(smsCalls[0].body.startsWith("Your Paperwork Monster code:"));
  await resetKv();
});

Deno.test("send-otp integration: re-sending rotates code and resets attempts", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { otps, flow } = freshFlow();

  const first = await flow.run({ phoneNumber: "+15125551234", language: "en" });
  await otps.recordAttempt("+15125551234");

  const second = await flow.run({ phoneNumber: "+15125551234", language: "en" });
  const stored = await otps.get("+15125551234");
  assertEquals(stored?.attempts, 0);                              // reset on rotate
  assertEquals(stored?.code, second.codeForDispatch);             // new code in place
  // First and second codes are typically different (statistically); assert no crash, not strict inequality.
  assert(typeof first.codeForDispatch === "string" && first.codeForDispatch.length === 6);
  await resetKv();
});

Deno.test("send-otp integration: SMS failure does NOT throw — logs + returns success so user can retry", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const otps = new OtpStore();
  const sms  = new SmsService();
  // deno-lint-ignore require-await
  sms.send = async () => ({ ok: false, reason: "twilio 503: outage" });
  const flow = new SendOtp(otps, sms);

  const result = await flow.run({ phoneNumber: "+15125551234" });
  // The HTTP layer above this still returns { sent: true } so the user
  // can hit "Resend code" once SMS recovers.
  assertEquals(result.sent, true);
  await resetKv();
});

Deno.test("send-otp integration: invalid phone propagates (and SMS is NOT attempted)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { smsCalls, flow } = freshFlow();
  let threw = false;
  try { await flow.run({ phoneNumber: "abc" }); } catch { threw = true; }
  assertEquals(threw, true);
  assertEquals(smsCalls.length, 0);
  await resetKv();
});
