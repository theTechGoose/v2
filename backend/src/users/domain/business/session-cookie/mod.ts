/**
 * Session cookie builders — the single source of truth for the `pm_session`
 * cookie shape. Shared by the auth controller (login/logout) and the admin
 * controller (impersonate / stop-impersonating), which all need to swap the
 * browser's effective session.
 */

export const SESSION_COOKIE_NAME = "pm_session";
const SESSION_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 30; // 30 days

/** True on Deno Deploy (production). False locally. Flips cookie attrs:
 *  prod gets `Secure; SameSite=None` for cross-origin api.* ↔ app.* sharing;
 *  local dev gets `SameSite=Lax` with no Secure flag because Safari silently
 *  drops Secure cookies on http://localhost. */
const IS_PROD = typeof Deno !== "undefined" &&
  Deno.env.get("DENO_DEPLOYMENT_ID") !== undefined;

function cookieAttrs(): string[] {
  if (IS_PROD) return ["HttpOnly", "Secure", "SameSite=None"];
  return ["HttpOnly", "SameSite=Lax"];
}

/** Set-Cookie value that installs `sessionId` for 30 days. HttpOnly stops JS
 *  from reading it; SameSite/Secure flip with env (see cookieAttrs). */
export function buildSessionCookie(sessionId: string): string {
  return [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    "Path=/",
    `Max-Age=${SESSION_COOKIE_MAX_AGE_S}`,
    ...cookieAttrs(),
  ].join("; ");
}

/** Set-Cookie value that clears the session cookie (Max-Age=0). */
export function clearSessionCookie(): string {
  return [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "Max-Age=0",
    ...cookieAttrs(),
  ].join("; ");
}
