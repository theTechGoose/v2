/**
 * P-03 [SECURITY/COST] — "POST /api/auth/send-otp is unauthenticated with ZERO
 * rate limiting → SMS-pumping toll fraud. … Bonus hole: every re-send resets
 * attempts=0, defeating the MAX_ATTEMPTS=5 OTP brute-force guard."
 * <<solution>> set a backend 30 second cooldown per phone.
 *
 * Target: shared/quote-flow/otp-rate-limit.ts  (does not exist yet — the
 * "Cannot find module" failure is the intended TDD red).
 *
 * Expected exports (mirroring the real record shapes in
 * backend/src/users/domain/data/otp-store/mod.ts — OtpRecord is
 * { phoneNumber, code, language?, attempts: number, sentAt: ISO string }):
 *
 *   export const SEND_OTP_COOLDOWN_SECONDS = 30;
 *
 *   export interface SendOtpGateInput {
 *     phone: string;
 *     // OtpRecord.sentAt of the previous send for this phone, or null.
 *     lastSentAt: string | null;
 *     // ISO timestamp of the incoming request.
 *     now: string;
 *   }
 *   export interface SendOtpGateResult {
 *     allowed: boolean;
 *     // 0 when allowed; whole seconds (ceil) until the next allowed send.
 *     retryAfterSeconds: number;
 *   }
 *   export function evaluateSendOtp(input: SendOtpGateInput): SendOtpGateResult;
 *
 *   export interface OtpRecordLike {
 *     phoneNumber: string;
 *     code: string;
 *     language?: string;
 *     attempts: number;
 *     sentAt: string;
 *   }
 *   export function mergeOtpRecordOnResend(
 *     existing: OtpRecordLike | null,
 *     fresh: OtpRecordLike,
 *   ): OtpRecordLike;
 *
 * Wiring points for the fix:
 *   - backend/src/users/domain/coordinators/send-otp/mod.ts:43-58 — SendOtp.run
 *     must gate on evaluateSendOtp (existing record's sentAt vs now) BEFORE
 *     generating/persisting/dispatching, and the auth controller
 *     (backend/src/users/entrypoints/auth-controller/mod.ts:36-44) must surface
 *     the rejection as an HTTP 4xx (429), never {"sent":true}.
 *   - backend/src/users/domain/data/otp-store/mod.ts:29-40 — put() hardcodes
 *     attempts: 0 on every overwrite; the resend path must persist
 *     mergeOtpRecordOnResend(existing, fresh) so a resend can NEVER reopen a
 *     phone locked by MAX_ATTEMPTS=5
 *     (backend/src/users/domain/coordinators/verify-otp/mod.ts:171).
 */
import {
  evaluateSendOtp,
  mergeOtpRecordOnResend,
  SEND_OTP_COOLDOWN_SECONDS,
} from "../../shared/quote-flow/otp-rate-limit";

const PHONE = "+15125552000";
const T0 = "2026-08-18T12:00:00.000Z";

/** T0 shifted by `ms` milliseconds. */
function at(ms: number): string {
  return new Date(Date.parse(T0) + ms).toISOString();
}

describe("P-03: evaluateSendOtp — 30s per-phone cooldown", () => {
  it("P-03: exposes a 30 second cooldown constant", () => {
    expect(SEND_OTP_COOLDOWN_SECONDS).toBe(30);
  });

  it("P-03: a phone with no prior send is allowed immediately", () => {
    const r = evaluateSendOtp({ phone: PHONE, lastSentAt: null, now: T0 });
    expect(r.allowed).toBe(true);
    expect(r.retryAfterSeconds).toBe(0);
  });

  it("P-03: a re-send 5s after the last one is blocked with 25s remaining", () => {
    const r = evaluateSendOtp({
      phone: PHONE,
      lastSentAt: T0,
      now: at(5_000),
    });
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSeconds).toBe(25);
  });

  it("P-03: a blocked result never reports 0 retry seconds (ceil, not floor)", () => {
    // 29.2s elapsed → 0.8s remaining → Retry-After must round UP to 1.
    const r = evaluateSendOtp({
      phone: PHONE,
      lastSentAt: T0,
      now: at(29_200),
    });
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSeconds).toBe(1);
  });

  it("P-03: exactly 30s after the last send is allowed again", () => {
    const r = evaluateSendOtp({
      phone: PHONE,
      lastSentAt: T0,
      now: at(30_000),
    });
    expect(r.allowed).toBe(true);
    expect(r.retryAfterSeconds).toBe(0);
  });

  it("P-03: a long-expired cooldown is allowed", () => {
    const r = evaluateSendOtp({
      phone: PHONE,
      lastSentAt: T0,
      now: at(10 * 60_000),
    });
    expect(r.allowed).toBe(true);
    expect(r.retryAfterSeconds).toBe(0);
  });
});

describe("P-03: mergeOtpRecordOnResend — a resend must NOT reset attempts", () => {
  const existing = {
    phoneNumber: PHONE,
    code: "482913",
    language: "en",
    attempts: 5, // phone is LOCKED (MAX_ATTEMPTS=5, verify-otp/mod.ts:171)
    sentAt: T0,
  };
  const fresh = {
    phoneNumber: PHONE,
    code: "170356",
    language: "es",
    attempts: 0, // what OtpStore.put would naively write today
    sentAt: at(60_000),
  };

  it("P-03: preserves the prior attempts counter (the brute-force lock survives a resend)", () => {
    const merged = mergeOtpRecordOnResend(existing, fresh);
    expect(merged.attempts).toBe(5);
  });

  it("P-03: still rotates the code and sentAt to the fresh values", () => {
    const merged = mergeOtpRecordOnResend(existing, fresh);
    expect(merged.code).toBe("170356");
    expect(merged.sentAt).toBe(at(60_000));
    expect(merged.phoneNumber).toBe(PHONE);
    expect(merged.language).toBe("es");
  });

  it("P-03: with no existing record the fresh record passes through (attempts 0)", () => {
    const merged = mergeOtpRecordOnResend(null, fresh);
    expect(merged).toEqual(fresh);
  });
});
