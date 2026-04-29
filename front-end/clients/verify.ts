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
  | { ok: true; sessionId: string; userId: string; redirectTo: string }
  | { ok: false; error: VerifyOtpError };

export interface ResendOtpInput {
  phoneNumber: string;
  language?: Lang;
}

const KNOWN_ERRORS: ReadonlySet<string> = new Set(["invalid_code", "expired", "rate_limited"]);

function asError(raw: unknown): VerifyOtpError {
  const body = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const code = typeof body.error === "string" ? body.error : "";
  return KNOWN_ERRORS.has(code) ? code as VerifyOtpError : "invalid_code";
}

export const verifyClient = {
  async verifyOtp(input: VerifyOtpInput, opts: ApiOptions = {}): Promise<VerifyOtpResult> {
    try {
      const raw = await api.post<{ sessionId?: string; userId?: string }>("/auth/verify-otp", input, opts);
      if (typeof raw.sessionId === "string" && typeof raw.userId === "string") {
        return { ok: true, sessionId: raw.sessionId, userId: raw.userId, redirectTo: "/dashboard" };
      }
      return { ok: false, error: "invalid_code" };
    } catch (err) {
      if (err instanceof ApiError) return { ok: false, error: asError(err.body) };
      throw err;
    }
  },

  /** POST /api/auth/send-otp — resend the OTP code. */
  resendOtp(input: ResendOtpInput, opts: ApiOptions = {}): Promise<{ sent: true }> {
    return api.post<{ sent: true }>("/auth/send-otp", input, opts);
  },
};
