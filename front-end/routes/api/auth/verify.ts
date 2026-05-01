/**
 * POST /api/auth/verify — proxy to backend /auth/verify-otp.
 *
 * Forwards the body and pipes Set-Cookie back so the browser stores
 * `pm_session`. On success the backend returns `{ sessionId, userId }`;
 * the proxy normalizes this to `{ ok: true, sessionId, userId, redirectTo }`
 * for the client island to consume. Errors come back as `{ ok: false, error }`.
 */
import { define } from "../../../utils.ts";

const BACKEND_URL = Deno.env.get("BACKEND_URL") ?? "http://localhost:3000";

export const handler = define.handlers({
  async POST(ctx) {
    const body = await ctx.req.text();

    let res: Response;
    try {
      res = await fetch(`${BACKEND_URL}/auth/verify-otp`, {
        method: "POST",
        headers: { "content-type": "application/json", "accept": "application/json" },
        body,
      });
    } catch {
      return new Response(JSON.stringify({ ok: false, error: "backend_unreachable" }), {
        status: 502,
        headers: { "content-type": "application/json" },
      });
    }

    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try { parsed = text.length > 0 ? JSON.parse(text) : {}; } catch { /* ignore */ }

    const headers = new Headers({ "content-type": "application/json" });
    const upstreamCookie = res.headers.get("set-cookie");
    if (upstreamCookie) headers.set("set-cookie", upstreamCookie);

    if (res.ok && typeof parsed.sessionId === "string") {
      const isNewUser = parsed.isNewUser === true;
      const redirectTo = isNewUser ? "/assistant?onboard=1" : "/dashboard?welcome=back";
      return new Response(
        JSON.stringify({ ok: true, sessionId: parsed.sessionId, userId: parsed.userId, isNewUser, redirectTo }),
        { status: 200, headers },
      );
    }

    const code = typeof parsed.error === "string" ? parsed.error : "invalid_code";
    return new Response(JSON.stringify({ ok: false, error: code }), {
      status: res.status >= 400 ? res.status : 400,
      headers,
    });
  },
});
