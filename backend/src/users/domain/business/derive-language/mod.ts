import type { Language, User } from "@users/dto/user.ts";

/**
 * Decide which language to set on a User after a verify-otp.
 *
 * - For an EXISTING user: keep their current preference; never overwrite from
 *   a transient OTP toggle. Returns `existing.language` (or undefined).
 * - For a NEW user: copy `otpLanguage` from the OTP record. Defaults to "en"
 *   when the OTP record didn't carry a language.
 *
 * The same logic applies to all places that need to "first-time-only" copy
 * a transient signup signal into permanent user state.
 */
export function deriveLanguageOnVerify(
  existing: User | null,
  otpLanguage: Language | undefined,
): Language | undefined {
  if (existing) return existing.language;
  return otpLanguage ?? "en";
}
