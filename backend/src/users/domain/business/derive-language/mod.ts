import type { Language, User } from "@users/dto/user.ts";

/**
 * Decide which language to set on a User after a verify-otp.
 *
 * - For an EXISTING user: keep their current preference; never overwrite from
 *   a transient OTP toggle. Returns `existing.language` (or undefined).
 * - For a NEW user: the language picked on /verify (`pickedLanguage`, REQ-590 —
 *   the code page's EN | ES toggle, sent with the code) wins; else copy
 *   `otpLanguage` from the OTP record. Defaults to "es" (Spanish-first — the
 *   app is built for Spanish-speaking contractors) when neither carried one.
 *
 * The same logic applies to all places that need to "first-time-only" copy
 * a transient signup signal into permanent user state.
 */
export function deriveLanguageOnVerify(
  existing: User | null,
  otpLanguage: Language | undefined,
  pickedLanguage?: Language,
): Language | undefined {
  if (existing) return existing.language;
  return pickedLanguage ?? otpLanguage ?? "es";
}
