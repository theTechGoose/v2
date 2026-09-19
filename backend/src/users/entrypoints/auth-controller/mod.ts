import { Body, Context, Controller, Post } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import {
  SendOtp,
  SendOtpCooldownError,
} from "@users/domain/coordinators/send-otp/mod.ts";
import {
  ExpiredCodeError,
  InvalidCodeError,
  RateLimitedError,
  VerifyOtp,
  AccountClosedError,
} from "@users/domain/coordinators/verify-otp/mod.ts";
import { Logout } from "@users/domain/coordinators/logout/mod.ts";
import { AccountRecovery } from "@users/domain/coordinators/account-recovery/mod.ts";
import { InvalidRecoveryTokenError } from "@users/domain/data/recovery-token-store/mod.ts";
import { parseSendOtp, parseVerifyOtp } from "@users/dto/auth.ts";
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
  ) {}

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
        redirectTo: "/dashboard?welcome=back",
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
      ctx.header("Set-Cookie", buildSessionCookie(result.sessionId));
      return {
        ok: true,
        sessionId: result.sessionId,
        userId: result.userId,
        isNewUser: true,
        redirectTo: "/welcome",
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
   * fire-and-respond. The OTP code is NEVER returned to the client; it goes
   * through the SMS adapter instead.
   *
   * P-03: a second send for the same phone inside the 30-second cooldown is
   * rejected with 429 + Retry-After and never claims `{sent:true}`.
   */
  @Post("send-otp")
  async send(@Body() body: unknown) {
    const dto = parseSendOtp(body);
    try {
      await this.sendOtp.run({
        phoneNumber: dto.phoneNumber,
        language: dto.language,
      });
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
    return { sent: true };
  }

  /**
   * POST /auth/verify — same semantics as /auth/verify-otp but with REAL
   * HTTP statuses and the `{ ok, redirectTo }` envelope the frontend proxy
   * at /api/auth/verify produces, so direct API/SDK/test clients get one
   * consistent contract whether they go through the proxy or not:
   *   - 200 { ok:true, sessionId, userId, isNewUser, redirectTo } + cookie
   *   - 401 { ok:false, error:"invalid_code" }
   *   - 410 { ok:false, error:"expired" }
   *   - 429 { ok:false, error:"rate_limited" }
   */
  @Post("verify")
  async verifyDirect(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const dto = parseVerifyOtp(body);
    try {
      const result = await this.verifyOtp.run({
        phoneNumber: dto.phoneNumber,
        code: dto.code,
      });
      ctx.header("Set-Cookie", buildSessionCookie(result.sessionId));
      return {
        ok: true,
        sessionId: result.sessionId,
        userId: result.userId,
        isNewUser: result.isNewUser,
        redirectTo: result.isNewUser ? "/welcome" : "/dashboard?welcome=back",
      };
    } catch (err) {
      if (err instanceof AccountClosedError) return closedResponse(err);
      const mapped = mapVerifyError(err);
      if (mapped) return jsonResponse({ ok: false, error: mapped.error }, mapped.status);
      throw err;
    }
  }

  /**
   * POST /auth/verify-otp
   * body: { phoneNumber, code }
   *
   * On success: sets `pm_session` as an HTTP-only cookie AND returns the
   * session id in the response body so SDK / API clients without cookie
   * jars can keep using the `x-session-id` header.
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
      ctx.header("Set-Cookie", buildSessionCookie(result.sessionId));
      return {
        sessionId: result.sessionId,
        userId: result.userId,
        isNewUser: result.isNewUser,
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
  if (err instanceof InvalidCodeError) return { error: "invalid_code", status: 401 };
  if (err instanceof ExpiredCodeError) return { error: "expired", status: 410 };
  if (err instanceof RateLimitedError) return { error: "rate_limited", status: 429 };
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
