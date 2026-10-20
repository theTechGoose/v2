import { Body, Context, Controller, Post } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import {
  SendOtp,
  SendOtpCooldownError,
} from "@users/domain/coordinators/send-otp/mod.ts";
import { devCodeFor } from "@users/domain/business/dev-code/mod.ts";
import {
  AccountClosedError,
  ExpiredCodeError,
  InvalidCodeError,
  RateLimitedError,
  VerifyOtp,
} from "@users/domain/coordinators/verify-otp/mod.ts";
import { Logout } from "@users/domain/coordinators/logout/mod.ts";
import {
  ClosedAccountError,
  InvalidEmailError,
  SendEmailOtp,
} from "@users/domain/coordinators/send-email-otp/mod.ts";
import { VerifyEmailOtp } from "@users/domain/coordinators/verify-email-otp/mod.ts";
import { CrmLeadCapture } from "@users/domain/coordinators/crm-lead-capture/mod.ts";
import { AccountRecovery } from "@users/domain/coordinators/account-recovery/mod.ts";
import { SignInLanding } from "@users/domain/coordinators/sign-in-landing/mod.ts";
import { ChoosePlan } from "@users/domain/coordinators/choose-plan/mod.ts";
import { InvalidRecoveryTokenError } from "@users/domain/data/recovery-token-store/mod.ts";
import {
  parseSendEmailOtp,
  parseSendOtp,
  parseVerifyEmailOtp,
  parseVerifyOtp,
} from "@users/dto/auth.ts";
import { readSessionId } from "@users/domain/coordinators/require-user/mod.ts";
import {
  buildSessionCookie,
  clearSessionCookie,
} from "@users/domain/business/session-cookie/mod.ts";

function readToken(body: unknown): string {
  const t = (body as { token?: unknown } | null)?.token;
  if (typeof t !== "string" || !t.trim()) throw new Error("token is required");
  return t.trim();
}

/**
 * REQ-039 (NW-52): the verified phone belongs to a closed account — no
 * session, no new account; the client offers recover / start fresh. (A
 * module function: Danet registers EVERY prototype method as a route, so
 * controllers carry no helper methods.)
 */
function closedResponse(err: AccountClosedError) {
  return { ok: true, recoverable: true, recoveryToken: err.recoveryToken };
}

@Controller("auth")
export class AuthController {
  constructor(
    private sendOtp: SendOtp,
    private verifyOtp: VerifyOtp,
    private logout: Logout,
    private recovery: AccountRecovery,
    private sendEmailOtp: SendEmailOtp,
    private verifyEmailOtp: VerifyEmailOtp,
    /** REQ-058 — a new account is a CRM customer from its first sign-in */
    /** REQ-072 — the login's lead capture: durable, never awaited by the request */
    private leads: CrmLeadCapture,
    /** REQ-091 — where a verified code lands: the wizard while an onboarding question is open */
    private landing: SignInLanding,
    /** REQ-104 — a Monster Free signup names free with the code: the plan is stored before the wizard asks anything */
    private choosePlan: ChoosePlan,
  ) {}

  /**
   * POST /auth/send-email-otp — REQ-050 (/login-internal): mail a 6-digit
   * code to any well-formed address; the account is found-or-created when
   * the code comes back, like the phone flow.
   * body: { email, language? }
   *   - 200 { sent:true }
   *   - 400 { ok:false, error:"invalid_email" }
   *   - 409 { ok:false, error:"account_closed" }
   *   - 429 { ok:false, error:"cooldown", retryAfterSeconds } + Retry-After
   */
  @Post("send-email-otp")
  async sendEmail(@Body() body: unknown) {
    const dto = parseSendEmailOtp(body);
    try {
      await this.sendEmailOtp.run({ email: dto.email, language: dto.language });
    } catch (err) {
      const mapped = mapEmailError(err);
      if (mapped) {
        return jsonResponse({ ok: false, error: mapped.error }, mapped.status);
      }
      if (err instanceof SendOtpCooldownError) {
        return jsonResponse(
          {
            ok: false,
            error: "cooldown",
            retryAfterSeconds: err.retryAfterSeconds,
          },
          429,
          { "retry-after": String(err.retryAfterSeconds) },
        );
      }
      throw err;
    }
    return { sent: true };
  }

  /**
   * POST /auth/verify-email-otp — REQ-050: the emailed code opens the
   * session of the account that carries the address, creating it when none
   * does. Same envelope and statuses as /auth/verify, plus the email-only
   * answers:
   *   - 200 { ok:true, sessionId, userId, isNewUser, redirectTo } + cookie
   *   - 401 invalid_code · 410 expired · 429 rate_limited
   *   - 400 invalid_email · 409 account_closed
   */
  @Post("verify-email-otp")
  async verifyEmail(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const dto = parseVerifyEmailOtp(body);
    try {
      const result = await this.verifyEmailOtp.run({
        email: dto.email,
        code: dto.code,
      });
      if (result.isNewUser) await this.leads.enqueueSync(result.userId); // REQ-098
      ctx.header("Set-Cookie", buildSessionCookie(result.sessionId));
      return {
        ok: true,
        sessionId: result.sessionId,
        userId: result.userId,
        isNewUser: result.isNewUser,
        redirectTo: await this.landing.run(result.userId),
      };
    } catch (err) {
      const mapped = mapEmailError(err) ?? mapVerifyError(err);
      if (mapped) {
        return jsonResponse({ ok: false, error: mapped.error }, mapped.status);
      }
      throw err;
    }
  }

  /** POST /auth/recover { token } — the closed account comes back as it was. */
  @Post("recover")
  async recover(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const token = readToken(body);
    try {
      const result = await this.recovery.recover(token);
      ctx.header("Set-Cookie", buildSessionCookie(result.sessionId));
      return {
        ok: true,
        sessionId: result.sessionId,
        userId: result.userId,
        isNewUser: false,
        redirectTo: await this.landing.run(result.userId),
      };
    } catch (err) {
      if (err instanceof InvalidRecoveryTokenError) {
        return jsonResponse({ ok: false, error: "invalid_token" }, 401);
      }
      throw err;
    }
  }

  /** POST /auth/start-fresh { token } — a new account on the number; the old
   *  one keeps its data under an archived phone. */
  @Post("start-fresh")
  async startFresh(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const token = readToken(body);
    try {
      const result = await this.recovery.startFresh(token);
      await this.leads.enqueueSync(result.userId); // REQ-098
      ctx.header("Set-Cookie", buildSessionCookie(result.sessionId));
      return {
        ok: true,
        sessionId: result.sessionId,
        userId: result.userId,
        isNewUser: true,
        redirectTo: await this.landing.run(result.userId),
      };
    } catch (err) {
      if (err instanceof InvalidRecoveryTokenError) {
        return jsonResponse({ ok: false, error: "invalid_token" }, 401);
      }
      throw err;
    }
  }

  /**
   * POST /auth/send-otp
   * body: { phoneNumber, language? }
   *
   * Responds `{ sent: true }` on a well-formed phone, even if the
   * downstream SMS gateway is down — production should add observability so
   * silent SMS failures don't lock people out, but the API contract is
   * fire-and-respond. On the real deploy the OTP code is NEVER returned to the
   * client; it goes through the SMS adapter instead. On the fakes (REQ-082,
   * DENO_DEPLOY unset) the reply carries it as `devCode`, so the page can show
   * it — no text goes out there.
   *
   * P-03: a second send for the same phone inside the 30-second cooldown is
   * rejected with 429 + Retry-After and never claims `{sent:true}`.
   */
  @Post("send-otp")
  async send(@Body() body: unknown) {
    const dto = parseSendOtp(body);
    let devCode: string | undefined;
    try {
      const sent = await this.sendOtp.run({
        phoneNumber: dto.phoneNumber,
        language: dto.language,
      });
      devCode = devCodeFor(sent.codeForDispatch);
      // REQ-060 — the phone is a CRM lead the moment the code goes out, code entered or not.
      // REQ-072 — fire and forget, guaranteed: the lead is a KV outbox record before this
      // replies (ms), and the sweep carries it to the CRM and retries until the CRM confirms.
      // The CRM's Quickbase calls wait 10 s per 429; the login sat on "…" 22–31 s awaiting them.
      await this.leads.enqueue(dto.phoneNumber);
    } catch (err) {
      if (err instanceof SendOtpCooldownError) {
        return jsonResponse(
          {
            ok: false,
            error: "cooldown",
            retryAfterSeconds: err.retryAfterSeconds,
          },
          429,
          { "retry-after": String(err.retryAfterSeconds) },
        );
      }
      throw err;
    }
    return devCode ? { sent: true, devCode } : { sent: true };
  }

  /**
   * POST /auth/verify — same semantics as /auth/verify-otp but with REAL
   * HTTP statuses and the `{ ok, redirectTo }` envelope the frontend proxy
   * at /api/auth/verify produces, so direct API/SDK/test clients get one
   * consistent contract whether they go through the proxy or not:
   *   - 200 { ok:true, sessionId, userId, isNewUser, redirectTo } + cookie
   *     (redirectTo, REQ-091: /welcome while an onboarding question is open)
   *   - 401 { ok:false, error:"invalid_code" }
   *   - 410 { ok:false, error:"expired" }
   *   - 429 { ok:false, error:"rate_limited" }
   * `plan` (REQ-104) is taken the way /auth/verify-otp takes it.
   */
  @Post("verify")
  async verifyDirect(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const dto = parseVerifyOtp(body);
    try {
      const result = await this.verifyOtp.run({
        phoneNumber: dto.phoneNumber,
        code: dto.code,
      });
      // REQ-098 — the CRM customer is an outbox record; the sweep makes it after this reply
      if (result.isNewUser) await this.leads.enqueueSync(result.userId);
      // REQ-104 — a Monster Free signup: free is the plan from the code on; the wizard never asks it
      if (dto.plan === "free") await this.choosePlan.startFree(result.userId);
      ctx.header("Set-Cookie", buildSessionCookie(result.sessionId));
      return {
        ok: true,
        sessionId: result.sessionId,
        userId: result.userId,
        isNewUser: result.isNewUser,
        redirectTo: await this.landing.run(result.userId),
      };
    } catch (err) {
      if (err instanceof AccountClosedError) return closedResponse(err);
      const mapped = mapVerifyError(err);
      if (mapped) {
        return jsonResponse({ ok: false, error: mapped.error }, mapped.status);
      }
      throw err;
    }
  }

  /**
   * POST /auth/verify-otp
   * body: { phoneNumber, code, plan? }
   *
   * On success: sets `pm_session` as an HTTP-only cookie AND returns the
   * session id in the response body so SDK / API clients without cookie
   * jars can keep using the `x-session-id` header. `redirectTo` (REQ-091) is
   * where the code lands: /welcome while any onboarding question is open,
   * /dashboard?welcome=back once every one is answered — the page follows it.
   * `plan` (REQ-104): the plan the signup names — "free" from the landing's
   * Empezar gratis is stored as Monster Free on an account with no plan on
   * record, before the wizard asks anything, so the wizard never asks the
   * plan; a paid name stores nothing (the wizard asks, where the email and
   * the pay page are); a pick already on record stands.
   *
   * Errors are typed so the frontend can render the right message:
   *   - invalid_code  : code didn't match (attempts++)
   *   - expired       : OTP record absent or aged out
   *   - rate_limited  : too many attempts on this phone
   * Throws plain Error subclasses; the surrounding HTTP layer maps them.
   */
  @Post("verify-otp")
  async verify(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const dto = parseVerifyOtp(body);
    try {
      const result = await this.verifyOtp.run({
        phoneNumber: dto.phoneNumber,
        code: dto.code,
      });
      // REQ-098 — the CRM customer is an outbox record; the sweep makes it after this reply
      if (result.isNewUser) await this.leads.enqueueSync(result.userId);
      // REQ-104 — a Monster Free signup: free is the plan from the code on; the wizard never asks it
      if (dto.plan === "free") await this.choosePlan.startFree(result.userId);
      ctx.header("Set-Cookie", buildSessionCookie(result.sessionId));
      return {
        sessionId: result.sessionId,
        userId: result.userId,
        isNewUser: result.isNewUser,
        redirectTo: await this.landing.run(result.userId),
      };
    } catch (err) {
      if (err instanceof AccountClosedError) {
        return { recoverable: true, recoveryToken: err.recoveryToken };
      }
      if (err instanceof InvalidCodeError) {
        return errorBody("invalid_code", 401);
      }
      if (err instanceof ExpiredCodeError) return errorBody("expired", 410);
      if (err instanceof RateLimitedError) {
        return errorBody("rate_limited", 429);
      }
      throw err;
    }
  }

  /**
   * POST /auth/logout
   * Idempotent. Always returns ok regardless of whether the session existed.
   * Also clears the `pm_session` cookie via Max-Age=0.
   */
  @Post("logout")
  async logoutEndpoint(@Context() ctx: ExecutionContext) {
    const sessionId = readSessionId(ctx);
    if (sessionId) await this.logout.run(sessionId);
    ctx.header("Set-Cookie", clearSessionCookie());
    return { ok: true };
  }
}

function errorBody(code: string, _status: number) {
  // Status code mapping needs framework-specific wiring (Danet exception
  // filter); for v1 we return a tagged error body and let the frontend
  // proxy translate to HTTP status codes. The proxy at /api/auth/verify
  // looks at `ok: false` and maps `error` → status.
  return { ok: false, error: code };
}

/** Typed verify errors → { error, status }. Module-level (NOT a controller
 *  method — every controller prototype method registers as a route). */
function mapVerifyError(
  err: unknown,
): { error: string; status: number } | null {
  if (err instanceof InvalidCodeError) {
    return { error: "invalid_code", status: 401 };
  }
  if (err instanceof ExpiredCodeError) return { error: "expired", status: 410 };
  if (err instanceof RateLimitedError) {
    return { error: "rate_limited", status: 429 };
  }
  return null;
}

/** REQ-050: the email-login answers → { error, status }. Module-level like
 *  mapVerifyError (a controller method would register as a route). */
function mapEmailError(
  err: unknown,
): { error: string; status: number } | null {
  if (err instanceof InvalidEmailError) {
    return { error: "invalid_email", status: 400 };
  }
  if (err instanceof ClosedAccountError) {
    return { error: "account_closed", status: 409 };
  }
  return null;
}

/** Raw Response so Danet passes the status/headers through untouched. */
function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}
