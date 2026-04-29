import { Injectable } from "#danet/core";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import { normalizePhone } from "@users/domain/business/normalize-phone/mod.ts";
import { generateOtpCode } from "@users/domain/business/generate-otp-code/mod.ts";
import type { Language } from "@users/dto/user.ts";

export interface SendOtpInput {
  phoneNumber: string;
  language?: Language;
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
    const code = generateOtpCode();
    await this.otps.put({ phoneNumber: normalizedPhone, code, language: input.language });

    const body = renderSmsBody(code, input.language ?? "en");
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
  if (language === "es") return `Tu código de Paperwork Monsters: ${code}`;
  return `Your Paperwork Monsters code: ${code}`;
}
