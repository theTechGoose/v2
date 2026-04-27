import { Injectable } from "#danet/core";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { normalizePhone } from "@users/domain/business/normalize-phone/mod.ts";
import { deriveLanguageOnVerify } from "@users/domain/business/derive-language/mod.ts";

const MAX_ATTEMPTS = 5;

export class InvalidCodeError    extends Error { constructor() { super("invalid_code");    this.name = "InvalidCodeError"; } }
export class ExpiredCodeError    extends Error { constructor() { super("expired");         this.name = "ExpiredCodeError"; } }
export class RateLimitedError    extends Error { constructor() { super("rate_limited");    this.name = "RateLimitedError"; } }

export interface VerifyOtpInput  { phoneNumber: string; code: string; }
export interface VerifyOtpResult { sessionId: string; userId: string; }

/**
 * VerifyOtp — confirm the code, find-or-create the User, mint a session.
 *
 * Flow:
 *   1. Normalize the phone (must match the form SendOtp stored under).
 *   2. Look up the OTP record; missing → ExpiredCodeError.
 *   3. If too many prior attempts, RateLimitedError.
 *   4. Compare codes (constant-time would be nicer but TS strings are fine here).
 *      Mismatch → recordAttempt + throw InvalidCodeError.
 *   5. Match: clear the OTP, find or create the User, copy `language` from
 *      the OTP record into a brand-new user (see derive-language).
 *   6. Create + return a fresh session.
 */
@Injectable()
export class VerifyOtp {
  constructor(
    private otps: OtpStore,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  async run(input: VerifyOtpInput): Promise<VerifyOtpResult> {
    const phone = normalizePhone(input.phoneNumber);

    const otp = await this.otps.get(phone);
    if (!otp) throw new ExpiredCodeError();
    if (otp.attempts >= MAX_ATTEMPTS) throw new RateLimitedError();

    if (otp.code !== input.code) {
      await this.otps.recordAttempt(phone);
      throw new InvalidCodeError();
    }

    await this.otps.clear(phone);

    const existing = await this.users.findByPhone(phone);
    const language = deriveLanguageOnVerify(existing, otp.language);
    const user = existing
      ? (language && language !== existing.language
          ? await this.users.update(existing.id, { language })
          : existing)
      : await this.users.create({ phoneNumber: phone, language });

    const session = await this.sessions.create(user.id);
    return { sessionId: session.id, userId: user.id };
  }
}
