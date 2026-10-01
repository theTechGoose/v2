import { Injectable } from "#danet/core";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import {
  ClosedAccountError,
  emailOtpKey,
  InvalidEmailError,
} from "@users/domain/coordinators/send-email-otp/mod.ts";
import {
  ExpiredCodeError,
  InvalidCodeError,
  placeholderNameFor,
  RateLimitedError,
} from "@users/domain/coordinators/verify-otp/mod.ts";
import { normalizeEmail } from "#quote-flow/normalize-email.ts";
import type { Language, User } from "@users/dto/user.ts";

const MAX_ATTEMPTS = 5;

/** The same universal dev/CI bypass as the phone flow: off Deno Deploy, the
 *  master code logs in (finding or creating the account) without a record. */
const DEV_MASTER_CODE = "000000";
const IS_PROD = typeof Deno !== "undefined" &&
  Deno.env.get("DENO_DEPLOYMENT_ID") !== undefined;

interface VerifyEmailOtpInput {
  email: string;
  code: string;
}
interface VerifyEmailOtpResult {
  sessionId: string;
  userId: string;
  isNewUser: boolean;
}

/**
 * VerifyEmailOtp (REQ-050) — confirm the emailed code, find-or-create the
 * account that carries the address, mint a session. Mirrors VerifyOtp:
 *
 *   1. Normalize the address; a closed account on it → ClosedAccountError.
 *   2. Dev master code off Deno Deploy → find-or-create, no record needed.
 *   3. Otherwise the record under `email:<address>`: missing → expired, too
 *      many attempts → rate-limited, mismatch → attempt++ and invalid.
 *   4. Match: clear the record; find the account or create it (the email,
 *      the OTP's language, the placeholder name, NO phone); open the session.
 */
@Injectable()
export class VerifyEmailOtp {
  constructor(
    private otps: OtpStore,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  async run(input: VerifyEmailOtpInput): Promise<VerifyEmailOtpResult> {
    const email = normalizeEmail(input.email);
    if (!email) throw new InvalidEmailError();

    const existing = await this.users.findByEmail(email);
    if (existing?.deletedAt) throw new ClosedAccountError();

    const key = emailOtpKey(email);
    if (!IS_PROD && input.code === DEV_MASTER_CODE) {
      const otpLang = existing
        ? undefined
        : (await this.otps.get(key))?.language;
      return await this.open(existing, email, otpLang);
    }

    const otp = await this.otps.get(key);
    if (!otp) throw new ExpiredCodeError();
    if (otp.attempts >= MAX_ATTEMPTS) throw new RateLimitedError();
    if (otp.code !== input.code) {
      await this.otps.recordAttempt(key);
      throw new InvalidCodeError();
    }
    await this.otps.clear(key);
    return await this.open(existing, email, otp.language);
  }

  /** The existing account, or a new one on the address (the email, the
   *  OTP's language, the placeholder name — and NO phone). */
  private async open(
    existing: User | null,
    email: string,
    otpLanguage: Language | undefined,
  ): Promise<VerifyEmailOtpResult> {
    const language: Language = otpLanguage ?? "es";
    const user = existing ??
      await this.users.create({
        email,
        language,
        name: placeholderNameFor(language),
      });
    const session = await this.sessions.create(user.id);
    return { sessionId: session.id, userId: user.id, isNewUser: !existing };
  }
}
