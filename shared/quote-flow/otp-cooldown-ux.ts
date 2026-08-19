/**
 * OTP send-cooldown UX (UX-33) — the browser-facing classification of
 * POST /api/auth/send-otp results. The API half is done (P-03): a cooldown
 * hit answers 429 {ok:false, error:"cooldown", retryAfterSeconds}. The FE
 * used to collapse every non-ok response into one generic "couldn't send"
 * failure, inviting retries while a valid code sat in the user's SMS.
 *
 * Pure logic, no side effects.
 */

import { SEND_OTP_COOLDOWN_SECONDS } from "./otp-rate-limit.ts";

export type SendOtpOutcome =
  | { kind: "sent" }
  | { kind: "cooldown"; retryAfterSeconds: number }
  | { kind: "failed" };

/**
 * Classify the browser-facing result of POST /api/auth/send-otp.
 *  - 2xx → sent
 *  - 429 (any body) → cooldown; retryAfterSeconds from the body when it is a
 *    positive finite number, else the shared cooldown constant so the UI can
 *    ALWAYS render a countdown (never 0).
 *  - anything else → failed (the generic error copy is correct there only).
 */
export function classifySendOtpResponse(
  status: number,
  body: unknown,
): SendOtpOutcome {
  if (status >= 200 && status < 300) return { kind: "sent" };
  if (status === 429) {
    const raw = (body as { retryAfterSeconds?: unknown } | null | undefined)
      ?.retryAfterSeconds;
    const secs = typeof raw === "number" && Number.isFinite(raw) && raw > 0
      ? Math.ceil(raw)
      : SEND_OTP_COOLDOWN_SECONDS;
    return { kind: "cooldown", retryAfterSeconds: secs };
  }
  return { kind: "failed" };
}

/**
 * The user-facing cooldown line for the landing form: reassures that a code
 * was ALREADY sent and carries the live countdown — never reads as the
 * generic send-failure.
 */
export function cooldownMessage(
  lang: "en" | "es",
  secondsLeft: number,
): string {
  return lang === "es"
    ? `Ya te enviamos un código — revísalo. Puedes pedir otro en ${secondsLeft} s.`
    : `We already sent you a code — check your messages. You can request another in ${secondsLeft}s.`;
}
