import { Injectable } from "#danet/core";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { EmailService } from "@communication/domain/data/email-service/mod.ts";
import { generateOtpCode } from "@users/domain/business/generate-otp-code/mod.ts";
import { SendOtpCooldownError } from "@users/domain/coordinators/send-otp/mod.ts";
import { evaluateSendOtp } from "#quote-flow/otp-rate-limit.ts";
import { normalizeEmail } from "#quote-flow/normalize-email.ts";
import type { Language } from "@users/dto/user.ts";
import { t } from "@core/i18n/mod.ts";

/** REQ-050: the address is not shaped like an email. */
export class InvalidEmailError extends Error {
  constructor() {
    super("invalid_email");
    this.name = "InvalidEmailError";
  }
}
/** REQ-050: the account with this email is closed (REQ-039); recovery is the
 *  phone flow's, so email login just says so. */
export class ClosedAccountError extends Error {
  constructor() {
    super("account_closed");
    this.name = "ClosedAccountError";
  }
}

/** The OTP store is keyed by subject; a phone's subject is its E.164 form, an
 *  email's is `email:<normalized address>` so the two never collide. */
export function emailOtpKey(normalizedEmail: string): string {
  return `email:${normalizedEmail}`;
}

interface SendEmailOtpInput {
  email: string;
  language?: Language;
}

interface SendEmailOtpResult {
  sent: true;
  normalizedEmail: string;
}

/**
 * SendEmailOtp (REQ-050) — normalize the address, generate a 6-digit code
 * under the same cooldown / attempts discipline as the SMS code, and mail it.
 * Any well-formed address gets a code, like any phone does: the account is
 * found-or-created when the code comes back (VerifyEmailOtp). The one refusal
 * is a closed account on the address — recovery is the phone flow's.
 *
 * Like SMS, a mail-dispatch failure is logged and does not fail the request:
 * the record exists and "Resend" works once mail recovers.
 */
@Injectable()
export class SendEmailOtp {
  constructor(private users: UserStore, private otps: OtpStore) {}

  /** EmailService is stateless and lives in CommunicationModule (which imports
   *  UsersModule, not the reverse), so it is instantiated here — the same seam
   *  VerifyOtp uses for the signup alert. Assignable so a test can hand in a
   *  fake sender instead of steering the real one through process env (which
   *  `deno test --parallel` shares across modules). */
  email: Pick<EmailService, "send"> = new EmailService();

  async run(input: SendEmailOtpInput): Promise<SendEmailOtpResult> {
    const normalizedEmail = normalizeEmail(input.email);
    if (!normalizedEmail) throw new InvalidEmailError();

    const user = await this.users.findByEmail(normalizedEmail);
    if (user?.deletedAt) throw new ClosedAccountError();

    const key = emailOtpKey(normalizedEmail);
    const existing = await this.otps.get(key);
    const gate = evaluateSendOtp({
      phone: key,
      lastSentAt: existing?.sentAt ?? null,
      now: new Date().toISOString(),
    });
    if (!gate.allowed) throw new SendOtpCooldownError(gate.retryAfterSeconds);

    const language: Language = input.language ?? user?.language ?? "es";
    const code = generateOtpCode();
    await this.otps.put({ phoneNumber: key, code, language });

    if (Deno.env.get("DEV_LOG_OTP") === "1") {
      console.log(`[otp:debug] code=${code} email=${normalizedEmail}`);
    }
    const result = await this.email.send({
      to: normalizedEmail,
      subject: t(language, "email.otpSubject", { code }),
      htmlBody: t(language, "email.otpBody", { code }),
    });
    if (!result.ok) {
      console.error(
        `[send-email-otp] mail dispatch failed for ${normalizedEmail}: ${result.reason}`,
      );
    }

    return { sent: true, normalizedEmail };
  }
}
