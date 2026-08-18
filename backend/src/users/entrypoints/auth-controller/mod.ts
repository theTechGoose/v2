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
} from "@users/domain/coordinators/verify-otp/mod.ts";
import { Logout } from "@users/domain/coordinators/logout/mod.ts";
import { parseSendOtp, parseVerifyOtp } from "@users/dto/auth.ts";
import { readSessionId } from "@users/domain/coordinators/require-user/mod.ts";
import {
  buildSessionCookie,
  clearSessionCookie,
} from "@users/domain/business/session-cookie/mod.ts";

@Controller("auth")
export class AuthController {
  constructor(
    private sendOtp: SendOtp,
    private verifyOtp: VerifyOtp,
    private logout: Logout,
  ) {}

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
   * POST /auth/verify — alias of /auth/verify-otp.
   *
   * The :5280 frontend proxy exposes the flow as /api/auth/verify; API
   * clients that talk to the backend directly (the jest integration
   * harness with API_BASE_URL pointed at this port) use the same path, so
   * the backend answers it too. Identical semantics to verify-otp.
   */
  @Post("verify")
  verifyAlias(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    return this.verify(ctx, body);
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
