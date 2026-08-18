import { Injectable } from "#danet/core";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import { normalizePhone } from "@users/domain/business/normalize-phone/mod.ts";
import { generateOtpCode } from "@users/domain/business/generate-otp-code/mod.ts";
import { evaluateSendOtp } from "#quote-flow/otp-rate-limit.ts";
import type { Language } from "@users/dto/user.ts";
import { t } from "@core/i18n/mod.ts";

export interface SendOtpInput {
  phoneNumber: string;
  language?: Language;
}

/**
 * P-03: thrown when a send is requested inside the 30s per-phone cooldown.
 * The controller surfaces it as HTTP 429 + Retry-After — never {sent:true}.
 * The cooldown state is the pending OTP record's own `sentAt` (key
 * ["otp", phone]), so `scripts/dev-wipe-user.ts` — which deletes every KV
 * key containing the phone — clears the cooldown along with the record.
 */
export class SendOtpCooldownError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("cooldown");
    this.name = "SendOtpCooldownError";
  }
}

export interface SendOtpResult {
  sent: true;
  /** E.164 form actually used as the storage key. */
  normalizedPhone: string;
  /**
   * Internal: code value the SMS gateway will deliver.
   * NEVER returned to API clients — exposed only for tests + the SMS adapter.
   */
  codeForDispatch: string;
}

/**
 * SendOtp — normalize phone, generate a 6-digit code, persist it, and
 * dispatch via SMS through SmsService.
 *
 * The OTP record carries `language` so:
 *   1. The SMS body is localized in EN or ES at this very moment.
 *   2. VerifyOtp can copy it onto a brand-new User on first sign-in
 *      (see derive-language/mod.ts).
 *
 * SMS dispatch failures are logged but DON'T fail the request — the user
 * has already submitted their number. Twilio outages would otherwise lock
 * everyone out. In that case, the OTP record still exists and the user
 * can hit "Resend code" once SMS recovers.
 */
@Injectable()
export class SendOtp {
  constructor(private otps: OtpStore, private sms: SmsService) {}

  async run(input: SendOtpInput): Promise<SendOtpResult> {
    const normalizedPhone = normalizePhone(input.phoneNumber);

    // P-03 gate: a pending OTP's sentAt is the last-send timestamp for this
    // phone. Reject BEFORE generating/persisting/dispatching so a blocked
    // request costs no SMS and leaves the existing record (and its attempts
    // lock) untouched.
    const existing = await this.otps.get(normalizedPhone);
    const gate = evaluateSendOtp({
      phone: normalizedPhone,
      lastSentAt: existing?.sentAt ?? null,
      now: new Date().toISOString(),
    });
    if (!gate.allowed) throw new SendOtpCooldownError(gate.retryAfterSeconds);

    const code = generateOtpCode();
    await this.otps.put({ phoneNumber: normalizedPhone, code, language: input.language });

    const body = renderSmsBody(code, input.language ?? "es");
    if (Deno.env.get("DEV_LOG_OTP") === "1") {
      console.log(`[otp:debug] code=${code} phone=${normalizedPhone}`);
    }
    const result = await this.sms.send({ to: normalizedPhone, body });
    if (!result.ok) {
      console.error(`[send-otp] SMS dispatch failed for ${normalizedPhone}: ${result.reason}`);
    }

    return { sent: true, normalizedPhone, codeForDispatch: code };
  }
}

/** Localized SMS body. Kept short so it fits in a single SMS segment. */
function renderSmsBody(code: string, language: Language): string {
  return t(language, "sms.otpCode", { code });
}
