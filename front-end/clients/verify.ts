/**
 * HTTP client for the /verify page.
 *
 * Hits backend /auth/verify-otp directly via /api/* (mod.ts forwards same-
 * process in prod; routes/api/[...path].ts proxies to BACKEND_URL in dev).
 * The earlier `/auth/verify` shim path 404'd in prod because mod.ts
 * strips `/api/` and the backend has no `/auth/verify` route — only
 * `/auth/verify-otp`. Translating the raw backend response into the
 * client's discriminated union here keeps CodeInput.tsx unchanged.
 */
import { api, ApiError, type ApiOptions } from "../lib/api.ts";
import type { Lang } from "../lib/lang.ts";

export interface VerifyOtpInput {
  phoneNumber: string;
  code: string;
}

export type VerifyOtpError = "invalid_code" | "expired" | "rate_limited";

export type VerifyOtpResult =
  | {
    ok: true;
    sessionId: string;
    userId: string;
    isNewUser: boolean;
    redirectTo: string;
  }
  /** REQ-039 (NW-52): the number belongs to a CLOSED account — nothing was
   *  signed in; the person chooses recover / start fresh with the token. */
  | { ok: true; recoverable: true; recoveryToken: string }
  | { ok: false; error: VerifyOtpError };

export interface RecoveryResult {
  ok: true;
  sessionId: string;
  userId: string;
  isNewUser: boolean;
  redirectTo: string;
}

export interface ResendOtpInput {
  phoneNumber: string;
  language?: Lang;
}

const KNOWN_ERRORS: ReadonlySet<string> = new Set([
  "invalid_code",
  "expired",
  "rate_limited",
]);

function asError(raw: unknown): VerifyOtpError {
  const body = raw && typeof raw === "object"
    ? raw as Record<string, unknown>
    : {};
  const code = typeof body.error === "string" ? body.error : "";
  return KNOWN_ERRORS.has(code) ? code as VerifyOtpError : "invalid_code";
}

export const verifyClient = {
  async verifyOtp(
    input: VerifyOtpInput,
    opts: ApiOptions = {},
  ): Promise<VerifyOtpResult> {
    try {
      const raw = await api.post<
        {
          sessionId?: string;
          userId?: string;
          isNewUser?: boolean;
          recoverable?: boolean;
          recoveryToken?: string;
        }
      >("/auth/verify-otp", input, opts);
      if (raw.recoverable === true && typeof raw.recoveryToken === "string") {
        return { ok: true, recoverable: true, recoveryToken: raw.recoveryToken };
      }
      if (typeof raw.sessionId === "string" && typeof raw.userId === "string") {
        const isNewUser = raw.isNewUser === true;
        const redirectTo = isNewUser
          ? "/assistant?onboard=1"
          : "/dashboard?welcome=back";
        return {
          ok: true,
          sessionId: raw.sessionId,
          userId: raw.userId,
          isNewUser,
          redirectTo,
        };
      }
      return { ok: false, error: "invalid_code" };
    } catch (err) {
      if (err instanceof ApiError) {
        return { ok: false, error: asError(err.body) };
      }
      throw err;
    }
  },

  /** POST /api/auth/send-otp — resend the OTP code. */
  /** REQ-039: bring the closed account back exactly as it was. Lands where
   *  a returning user lands. */
  async recover(token: string, opts: ApiOptions = {}): Promise<RecoveryResult> {
    const raw = await api.post<RecoveryResult>("/auth/recover", { token }, opts);
    return { ...raw, redirectTo: "/dashboard?welcome=back" };
  },

  /** REQ-039: a brand-new account on the number; the old one keeps its data.
   *  Lands where a brand-new user lands. */
  async startFresh(token: string, opts: ApiOptions = {}): Promise<RecoveryResult> {
    const raw = await api.post<RecoveryResult>("/auth/start-fresh", { token }, opts);
    return { ...raw, redirectTo: "/assistant?onboard=1" };
  },

  resendOtp(
    input: ResendOtpInput,
    opts: ApiOptions = {},
  ): Promise<{ sent: true }> {
    return api.post<{ sent: true }>("/auth/send-otp", input, opts);
  },
};
