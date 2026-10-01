import { Injectable } from "#danet/core";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import {
  ClosedAccountError,
  emailOtpKey,
  InvalidEmailError,
  UnknownEmailError,
} from "@users/domain/coordinators/send-email-otp/mod.ts";
import {
  ExpiredCodeError,
  InvalidCodeError,
  RateLimitedError,
} from "@users/domain/coordinators/verify-otp/mod.ts";
import { normalizeEmail } from "#quote-flow/normalize-email.ts";
import type { User } from "@users/dto/user.ts";

const MAX_ATTEMPTS = 5;

/** The same universal dev/CI bypass as the phone flow: off Deno Deploy, the
 *  master code logs the EXISTING account in without a record. It never
 *  creates an account — email login has no signup. */
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
  /** Always false: email login only ever opens an existing account. */
  isNewUser: false;
}

/**
 * VerifyEmailOtp (REQ-050) — confirm the emailed code and mint a session for
 * the account that carries the address.
 *
 *   1. Normalize the address; find the account (unknown → UnknownEmailError,
 *      closed → ClosedAccountError — never a new account).
 *   2. Dev master code off Deno Deploy → session, no record needed.
 *   3. Otherwise the record under `email:<address>`: missing → expired, too
 *      many attempts → rate-limited, mismatch → attempt++ and invalid.
 *   4. Match: clear the record, open the session.
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

    const user = await this.users.findByEmail(email);
    if (!user) throw new UnknownEmailError();
    if (user.deletedAt) throw new ClosedAccountError();

    if (!IS_PROD && input.code === DEV_MASTER_CODE) {
      return await this.open(user);
    }

    const key = emailOtpKey(email);
    const otp = await this.otps.get(key);
    if (!otp) throw new ExpiredCodeError();
    if (otp.attempts >= MAX_ATTEMPTS) throw new RateLimitedError();
    if (otp.code !== input.code) {
      await this.otps.recordAttempt(key);
      throw new InvalidCodeError();
    }
    await this.otps.clear(key);
    return await this.open(user);
  }

  private async open(user: User): Promise<VerifyEmailOtpResult> {
    const session = await this.sessions.create(user.id);
    return { sessionId: session.id, userId: user.id, isNewUser: false };
  }
}
