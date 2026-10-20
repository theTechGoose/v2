import { Injectable } from "#danet/core";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { normalizePhone } from "@users/domain/business/normalize-phone/mod.ts";
import { deriveLanguageOnVerify } from "@users/domain/business/derive-language/mod.ts";
import { issueRecoveryToken } from "@users/domain/data/recovery-token-store/mod.ts";
import { isPlaceholderName, placeholderNameFor } from "@users/domain/business/placeholder-name/mod.ts";

/**
 * REQ-039 (NW-52): the verified phone belongs to a CLOSED account. No
 * session is opened and no account is created — the caller offers
 * "recover" / "start fresh" with the one-shot token.
 */
export class AccountClosedError extends Error {
  readonly status = 409;
  constructor(public readonly userId: string, public readonly recoveryToken: string) {
    super("account_closed");
    this.name = "AccountClosedError";
  }
}

const MAX_ATTEMPTS = 5;

export { placeholderNameFor };

/** Universal dev/CI bypass. When NOT running on Deno Deploy, any phone
 *  number paired with this code logs in (find-or-create user + mint
 *  session) without needing a real OTP record. Lets Cypress / local
 *  scripts log in as anyone in one POST. Hard-disabled in prod. */
const DEV_MASTER_CODE = "000000";
/** Opt-in flag for older Cypress specs that expect the master OTP to
 *  also seed a fully-onboarded "Dev User / Dev Business" identity and
 *  short-circuit the new-user redirect. Off by default — only the
 *  specs that explicitly need it set it via cy.task. New specs should
 *  use cy.startFreshOnboarding() instead, which exercises the real
 *  send-OTP + verify-OTP flow end to end. */
const SEED_DEV_DEFAULTS = (typeof Deno !== "undefined")
  && Deno.env.get("DEV_MASTER_OTP_SEED_DEFAULTS") === "1";
const IS_PROD = typeof Deno !== "undefined" && Deno.env.get("DENO_DEPLOYMENT_ID") !== undefined;

export class InvalidCodeError    extends Error { constructor() { super("invalid_code");    this.name = "InvalidCodeError"; } }
export class ExpiredCodeError    extends Error { constructor() { super("expired");         this.name = "ExpiredCodeError"; } }
export class RateLimitedError    extends Error { constructor() { super("rate_limited");    this.name = "RateLimitedError"; } }

export interface VerifyOtpInput  { phoneNumber: string; code: string; }
export interface VerifyOtpResult { sessionId: string; userId: string; isNewUser: boolean; }

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
 *
 * REQ-103 — a new account's email to hello@documonster.com is the controller's record on the
 * outbox (CrmLeadCapture.enqueueSignupNotice), mailed by the sweep after the reply — never here.
 */
@Injectable()
export class VerifyOtp {
  constructor(
    private otps: OtpStore,
    private users: UserStore,
    private sessions: SessionStore,
    private businessIdentities: BusinessIdentityStore,
  ) {}

  async run(input: VerifyOtpInput): Promise<VerifyOtpResult> {
    const phone = normalizePhone(input.phoneNumber);

    if (!IS_PROD && input.code === DEV_MASTER_CODE) {
      const existing = await this.users.findByPhone(phone);
    if (existing?.deletedAt) {
      throw new AccountClosedError(existing.id, await issueRecoveryToken(existing.id));
    }
      // Honor the language the landing toggle sent via send-otp, even on the
      // master-OTP bypass: a brand-new user inherits the OTP record's language
      // (so dev signups with 000000 still respect the EN/ES toggle).
      const otpLang = existing
        ? undefined
        : (await this.otps.get(phone).catch(() => null))?.language;
      const newLang = deriveLanguageOnVerify(null, otpLang) ?? "es";
      let user = existing
        ?? await this.users.create({
          phoneNumber: phone,
          language: newLang,
          name: placeholderNameFor(newLang),
        });
      if (SEED_DEV_DEFAULTS) {
        // Legacy opt-in only. Seeds the onboarding-gate requirements
        // (user.name + identity.businessName) so callers that expect a
        // fully-onboarded user via master-OTP keep working. New specs
        // should NOT depend on this — use cy.startFreshOnboarding().
        if (isPlaceholderName(user.name)) {
          user = await this.users.update(user.id, { name: "Dev User" });
        }
        const identity = await this.businessIdentities.get(user.id);
        if (!identity?.businessName) {
          await this.businessIdentities.upsert(user.id, { businessName: "Dev Business" });
        }
      }
      const session = await this.sessions.create(user.id);
      // Report the real new-user state so the verify proxy can route
      // fresh phones into onboarding the same way the production OTP
      // path does. Opt-in seeders above already make the user appear
      // onboarded; that branch will still see isNewUser=false.
      const isNewUser = !existing;
      return { sessionId: session.id, userId: user.id, isNewUser };
    }

    const otp = await this.otps.get(phone);
    if (!otp) throw new ExpiredCodeError();
    if (otp.attempts >= MAX_ATTEMPTS) throw new RateLimitedError();

    if (otp.code !== input.code) {
      await this.otps.recordAttempt(phone);
      throw new InvalidCodeError();
    }

    await this.otps.clear(phone);

    const existing = await this.users.findByPhone(phone);
    if (existing?.deletedAt) {
      throw new AccountClosedError(existing.id, await issueRecoveryToken(existing.id));
    }
    const language = deriveLanguageOnVerify(existing, otp.language);
    const user = existing
      ? (language && language !== existing.language
          ? await this.users.update(existing.id, { language })
          : existing)
      : await this.users.create({
          phoneNumber: phone,
          language,
          name: placeholderNameFor(language),
        });

    const session = await this.sessions.create(user.id);
    return { sessionId: session.id, userId: user.id, isNewUser: !existing };
  }
}
