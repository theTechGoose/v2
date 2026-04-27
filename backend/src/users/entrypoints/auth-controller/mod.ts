import { Body, Context, Controller, Post } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { SendOtp } from "@users/domain/coordinators/send-otp/mod.ts";
import { VerifyOtp, InvalidCodeError, ExpiredCodeError, RateLimitedError } from "@users/domain/coordinators/verify-otp/mod.ts";
import { Logout } from "@users/domain/coordinators/logout/mod.ts";
import { parseSendOtp, parseVerifyOtp } from "@users/dto/auth.ts";
import { readSessionId } from "@users/entrypoints/auth-helpers.ts";

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
   * Always responds `{ sent: true }` on a well-formed phone, even if the
   * downstream SMS gateway is down — production should add observability so
   * silent SMS failures don't lock people out, but the API contract is
   * fire-and-respond. The OTP code is NEVER returned to the client; it goes
   * through the SMS adapter (not yet wired) instead.
   */
  @Post("send-otp")
  async send(@Body() body: unknown) {
    const dto = parseSendOtp(body);
    await this.sendOtp.run({ phoneNumber: dto.phoneNumber, language: dto.language });
    return { sent: true };
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
      const result = await this.verifyOtp.run({ phoneNumber: dto.phoneNumber, code: dto.code });
      ctx.header("Set-Cookie", buildSessionCookie(result.sessionId));
      return { sessionId: result.sessionId, userId: result.userId };
    } catch (err) {
      if (err instanceof InvalidCodeError) return errorBody("invalid_code", 401);
      if (err instanceof ExpiredCodeError) return errorBody("expired", 410);
      if (err instanceof RateLimitedError) return errorBody("rate_limited", 429);
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

const SESSION_COOKIE_NAME = "pm_session";
const SESSION_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 30;     // 30 days

function buildSessionCookie(sessionId: string): string {
  // SameSite=Lax keeps the cookie on top-level navigations (the public
  // signed/accepted pages POST cross-origin to a different host, and they
  // don't need this cookie). HttpOnly stops JS from reading it.
  // Secure is intentionally NOT set so dev (http://localhost) works; the
  // proxy in production can rewrite to add Secure when terminating TLS.
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    "Path=/",
    `Max-Age=${SESSION_COOKIE_MAX_AGE_S}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  return parts.join("; ");
}

function clearSessionCookie(): string {
  return [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Lax",
  ].join("; ");
}

function errorBody(code: string, _status: number) {
  // Status code mapping needs framework-specific wiring (Danet exception
  // filter); for v1 we return a tagged error body and let the frontend
  // proxy translate to HTTP status codes. The proxy at /api/auth/verify
  // looks at `ok: false` and maps `error` → status.
  return { ok: false, error: code };
}
