/**
 * HTTP client for the /verify page.
 *
 * Calls go through the Fresh proxy at /api/auth/* on the client (so the
 * server can set the pm_session cookie before forwarding to the backend),
 * or direct to the backend on the server.
 */
import { api, type ApiOptions } from "../lib/api.ts";
import type { Lang } from "../lib/lang.ts";

export interface VerifyOtpInput {
  phoneNumber: string;
  code: string;
}

export type VerifyOtpResult =
  | { ok: true; sessionId: string; userId: string; redirectTo: string }
  | { ok: false; error: "invalid_code" | "expired" | "rate_limited" };

export interface ResendOtpInput {
  phoneNumber: string;
  language?: Lang;
}

export const verifyClient = {
  /** POST /api/auth/verify (proxy → backend POST /auth/verify-otp). */
  verifyOtp(input: VerifyOtpInput, opts: ApiOptions = {}): Promise<VerifyOtpResult> {
    return api.post<VerifyOtpResult>("/auth/verify", input, opts);
  },

  /** POST /api/auth/send-otp — resend the OTP code. */
  resendOtp(input: ResendOtpInput, opts: ApiOptions = {}): Promise<{ sent: true }> {
    return api.post<{ sent: true }>("/auth/send-otp", input, opts);
  },
};
