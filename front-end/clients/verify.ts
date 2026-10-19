/**
 * HTTP client for the /verify page.
 *
 * Hits backend /auth/verify-otp directly via /api/* (mod.ts forwards same-
 * process in prod; routes/api/[...path].ts proxies to BACKEND_URL in dev).
 * The earlier `/auth/verify` shim path 404'd in prod because mod.ts
 * strips `/api/` and the backend has no `/auth/verify` route — only
 * `/auth/verify-otp`. Translating the raw backend response into the
 * client's discriminated union here keeps CodeInput.tsx unchanged.
 *
 * REQ-091: where the code lands is the backend's call (`redirectTo`): the
 * wizard while any onboarding question is open, the dashboard once every
 * one is answered — never derived here from the one-shot "new user" flag.
 */
import { api, ApiError, type ApiOptions } from "../lib/api.ts";
import type { Lang } from "../lib/lang.ts";

export interface VerifyOtpInput {
  phoneNumber: string;
  code: string;
}

export type VerifyOtpError =
  | "invalid_code"
  | "expired"
  | "rate_limited"
  /** REQ-050 (email login only): the account on the address is closed. */
  | "account_closed";

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

/** REQ-050: the email counterpart of VerifyOtpInput. */
interface VerifyEmailOtpInput {
  email: string;
  code: string;
}

const KNOWN_ERRORS: ReadonlySet<string> = new Set([
  "invalid_code",
  "expired",
  "rate_limited",
  "account_closed",
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
          redirectTo?: string;
          recoverable?: boolean;
          recoveryToken?: string;
        }
      >("/auth/verify-otp", input, opts);
      if (raw.recoverable === true && typeof raw.recoveryToken === "string") {
        return { ok: true, recoverable: true, recoveryToken: raw.recoveryToken };
      }
      if (typeof raw.sessionId === "string" && typeof raw.userId === "string") {
        return {
          ok: true,
          sessionId: raw.sessionId,
          userId: raw.userId,
          isNewUser: raw.isNewUser === true,
          // the wizard is the safe landing: it lets a finished account go to the dashboard itself
          redirectTo: raw.redirectTo ?? "/welcome",
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

  /** REQ-050: POST /auth/verify-email-otp — the emailed code opens the
   *  session of the account that carries the address (created when none
   *  does: isNewUser, redirectTo /welcome). The backend answers the
   *  `{ ok, redirectTo }` envelope with real statuses, so a failure is an
   *  ApiError whose body names the error. */
  async verifyEmailOtp(
    input: VerifyEmailOtpInput,
    opts: ApiOptions = {},
  ): Promise<VerifyOtpResult> {
    try {
      const raw = await api.post<
        { ok?: boolean; sessionId?: string; userId?: string; isNewUser?: boolean; redirectTo?: string }
      >("/auth/verify-email-otp", input, opts);
      if (raw.ok === true && typeof raw.sessionId === "string" && typeof raw.userId === "string") {
        const isNewUser = raw.isNewUser === true;
        return {
          ok: true,
          sessionId: raw.sessionId,
          userId: raw.userId,
          isNewUser,
          redirectTo: raw.redirectTo ?? (isNewUser ? "/welcome" : "/dashboard?welcome=back"),
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

  /** REQ-050: POST /auth/send-email-otp — resend the emailed code. */
  resendEmailOtp(
    input: { email: string; language?: Lang },
    opts: ApiOptions = {},
  ): Promise<{ sent: true }> {
    return api.post<{ sent: true }>("/auth/send-email-otp", input, opts);
  },

  /** REQ-039: bring the closed account back exactly as it was. Lands where
   *  the backend says (REQ-091): the wizard if a question is still open. */
  recover(token: string, opts: ApiOptions = {}): Promise<RecoveryResult> {
    return api.post<RecoveryResult>("/auth/recover", { token }, opts);
  },

  /** REQ-039: a brand-new account on the number; the old one keeps its data.
   *  Lands where the backend says: the wizard, nothing answered yet. */
  startFresh(token: string, opts: ApiOptions = {}): Promise<RecoveryResult> {
    return api.post<RecoveryResult>("/auth/start-fresh", { token }, opts);
  },

  resendOtp(
    input: ResendOtpInput,
    opts: ApiOptions = {},
  ): Promise<{ sent: true; devCode?: string }> {
    return api.post<{ sent: true; devCode?: string }>("/auth/send-otp", input, opts);
  },
};
