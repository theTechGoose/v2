/**
 * HTTP client for the landing page.
 *
 * Surfaces only the endpoint(s) landing actually calls.
 * Backend reference: backend/src/users/entrypoints/auth-controller/mod.ts
 */
import { api, type ApiOptions } from "../lib/api.ts";
import type { Lang } from "../lib/lang.ts";

export interface SendOtpInput {
  phoneNumber: string;
  language?: Lang;
}

export interface SendOtpResult {
  sent: true;
}

export const landingClient = {
  /** POST /auth/send-otp — initiate OTP login flow. */
  sendOtp(input: SendOtpInput, opts: ApiOptions = {}): Promise<SendOtpResult> {
    return api.post<SendOtpResult>("/auth/send-otp", input, opts);
  },
};
