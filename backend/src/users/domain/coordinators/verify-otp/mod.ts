import { Injectable } from "#danet/core";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { normalizePhone } from "@users/domain/business/normalize-phone/mod.ts";
import { deriveLanguageOnVerify } from "@users/domain/business/derive-language/mod.ts";
import type { Language, User } from "@users/dto/user.ts";
import { EmailService } from "@communication/domain/data/email-service/mod.ts";

const MAX_ATTEMPTS = 5;

/** Internal ops alert: who gets emailed when a brand-new user signs up.
 *  Overridable via SIGNUP_NOTIFY_EMAILS (comma-separated); falls back to the
 *  default team list. This fires ONLY on first-time signup, never on login. */
const DEFAULT_SIGNUP_NOTIFY = [
  "hp@hans.work",
  "amcgill@monsterrg.com",
  "raphael@rcincorporated.net",
];
function signupNotifyRecipients(): string[] {
  const raw = (typeof Deno !== "undefined" && Deno.env.get("SIGNUP_NOTIFY_EMAILS")) || "";
  const parsed = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return parsed.length ? parsed : DEFAULT_SIGNUP_NOTIFY;
}

/** Brand-new users have no name. We seed a neutral, language-appropriate
 *  placeholder at creation so the app's identity-dependent UI is reachable
 *  immediately — most importantly the sidebar's user block, which is the only
 *  entry point to /settings and only renders once a name (or business name)
 *  exists. Without a name a fresh user literally cannot open Settings. The
 *  placeholder is freely overwritable in Settings or via the assistant. */
const PLACEHOLDER_NAMES = { en: "New user", es: "Nuevo usuario" } as const;
function placeholderNameFor(language: Language | undefined): string {
  return language === "es" ? PLACEHOLDER_NAMES.es : PLACEHOLDER_NAMES.en;
}
/** True when `name` is empty or still the seeded placeholder — i.e. the user
 *  hasn't set a real name yet. Lets the legacy dev seeder overwrite the
 *  placeholder without clobbering a genuinely-onboarded user's name. */
function isPlaceholderName(name: string | undefined): boolean {
  const n = name?.trim() ?? "";
  return n.length === 0 || n === PLACEHOLDER_NAMES.en || n === PLACEHOLDER_NAMES.es;
}

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
 */
@Injectable()
export class VerifyOtp {
  constructor(
    private otps: OtpStore,
    private users: UserStore,
    private sessions: SessionStore,
    private businessIdentities: BusinessIdentityStore,
  ) {}

  /** EmailService is stateless (no injected deps) and UsersModule can't
   *  resolve it from DI (it lives in CommunicationModule, which imports
   *  UsersModule, not vice-versa), so we instantiate it directly. Kept off
   *  the constructor so existing `new VerifyOtp(...)` test call sites and
   *  Danet DI both keep working untouched. */
  private readonly email = new EmailService();

  /** Best-effort internal alert when a brand-new user is created. Never
   *  throws — a notification hiccup must not break signup/login. Awaited by
   *  callers so the dispatch completes before the request returns (fire-and-
   *  forget is unreliable on Deno Deploy, which can cut work after response). */
  private async notifyNewSignup(user: User): Promise<void> {
    try {
      const recipients = signupNotifyRecipients();
      if (recipients.length === 0) return;
      const [to, ...cc] = recipients;
      const when = new Date().toISOString();
      const htmlBody =
        `<h2>New Paperwork Monster signup 🎉</h2>` +
        `<p>A new contractor just created an account.</p>` +
        `<ul>` +
        `<li><strong>Phone:</strong> ${user.phoneNumber}</li>` +
        `<li><strong>Language:</strong> ${user.language ?? "en"}</li>` +
        `<li><strong>User ID:</strong> ${user.id}</li>` +
        `<li><strong>Signed up:</strong> ${when}</li>` +
        `</ul>`;
      await this.email.send({
        to,
        cc: cc.length ? cc : undefined,
        subject: "🎉 New Paperwork Monster signup",
        htmlBody,
      });
    } catch (err) {
      // Swallow — best-effort only.
      console.error("[verify-otp] new-signup notification failed:", (err as Error).message);
    }
  }

  async run(input: VerifyOtpInput): Promise<VerifyOtpResult> {
    const phone = normalizePhone(input.phoneNumber);

    if (!IS_PROD && input.code === DEV_MASTER_CODE) {
      const existing = await this.users.findByPhone(phone);
      // Honor the language the landing toggle sent via send-otp, even on the
      // master-OTP bypass: a brand-new user inherits the OTP record's language
      // (so dev signups with 000000 still respect the EN/ES toggle).
      const otpLang = existing
        ? undefined
        : (await this.otps.get(phone).catch(() => null))?.language;
      const newLang = deriveLanguageOnVerify(null, otpLang) ?? "en";
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
      if (!existing) await this.notifyNewSignup(user);
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

    if (!existing) await this.notifyNewSignup(user);
    const session = await this.sessions.create(user.id);
    return { sessionId: session.id, userId: user.id, isNewUser: !existing };
  }
}
