/**
 * OTP send rate limiting (P-03): a 30-second per-phone cooldown on
 * POST /api/auth/send-otp, plus resend merging that preserves the
 * brute-force attempts counter (MAX_ATTEMPTS lock survives a resend).
 *
 * Mirrors the record shape of backend/src/users/domain/data/otp-store
 * (OtpRecord: { phoneNumber, code, language?, attempts, sentAt }).
 */

export const SEND_OTP_COOLDOWN_SECONDS = 30;

export interface SendOtpGateInput {
  phone: string;
  /** OtpRecord.sentAt of the previous send for this phone, or null. */
  lastSentAt: string | null;
  /** ISO timestamp of the incoming request. */
  now: string;
}

export interface SendOtpGateResult {
  allowed: boolean;
  /** 0 when allowed; whole seconds (ceil) until the next allowed send. */
  retryAfterSeconds: number;
}

/** Gate a send-otp request against the per-phone cooldown. */
export function evaluateSendOtp(input: SendOtpGateInput): SendOtpGateResult {
  if (!input.lastSentAt) return { allowed: true, retryAfterSeconds: 0 };

  const elapsedMs = Date.parse(input.now) - Date.parse(input.lastSentAt);
  const cooldownMs = SEND_OTP_COOLDOWN_SECONDS * 1_000;
  if (!Number.isFinite(elapsedMs) || elapsedMs >= cooldownMs) {
    return { allowed: true, retryAfterSeconds: 0 };
  }
  // Round UP so a blocked result never reports 0 retry seconds.
  return {
    allowed: false,
    retryAfterSeconds: Math.ceil((cooldownMs - elapsedMs) / 1_000),
  };
}

export interface OtpRecordLike {
  phoneNumber: string;
  code: string;
  language?: string;
  attempts: number;
  sentAt: string;
}

/**
 * Merge a fresh OTP record over the existing one on resend: the code,
 * sentAt, and language rotate, but the attempts counter is preserved so
 * a resend can never reopen a phone locked by MAX_ATTEMPTS.
 */
export function mergeOtpRecordOnResend(
  existing: OtpRecordLike | null,
  fresh: OtpRecordLike,
): OtpRecordLike {
  if (!existing) return fresh;
  return { ...fresh, attempts: Math.max(existing.attempts, fresh.attempts) };
}
