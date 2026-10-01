/**
 * HTTP client for /login-internal (REQ-050): the email counterpart of the
 * landing client's sendOtp. Backend: POST /auth/send-email-otp.
 */
import { api, type ApiOptions } from "../lib/api.ts";
import type { Lang } from "../lib/lang.ts";

interface SendEmailOtpInput {
  email: string;
  language?: Lang;
}

export const loginInternalClient = {
  /** POST /auth/send-email-otp — mail a code to the address on an existing
   *  account. Errors arrive as ApiError with the backend's `{ error }` body
   *  (invalid_email 400, account_closed 409, cooldown 429). */
  sendEmailOtp(
    input: SendEmailOtpInput,
    opts: ApiOptions = {},
  ): Promise<{ sent: true }> {
    return api.post<{ sent: true }>("/auth/send-email-otp", input, opts);
  },
};
