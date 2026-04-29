/**
 * Auth helpers for Fresh routes / middlewares.
 *
 * Reads the `pm_session` cookie issued by the backend's /auth/verify-otp,
 * verifies session validity by hitting GET /me, and exposes the resolved User.
 *
 * No business logic — just plumbing between Fresh's request and the backend.
 */

import { api, ApiError, readSessionCookie } from "./api.ts";

export interface User {
  id: string;
  phoneNumber: string;
  name?: string;
  email?: string;
  language?: "en" | "es";
  createdAt: number;
  updatedAt: number;
}

// Defaults to OFF so a forgotten env var on prod can't accidentally render
// auth-gated pages with a stub user. Local dev opts in via
// DEV_BYPASS_AUTH=1 in .env.
const DEV_BYPASS = (typeof Deno !== "undefined"
  ? (Deno.env.get("DEV_BYPASS_AUTH") ?? "0")
  : "0") === "1";

/**
 * Resolve the current user from the request's pm_session cookie.
 * Returns undefined if the cookie is missing OR the backend says it's invalid (401/403).
 *
 * If the backend is unreachable AND DEV_BYPASS_AUTH=1 (opt-in for local dev),
 * returns a placeholder user so SSR can render the shell — the seed data in
 * /lib/dash-seed.ts and /lib/assistant-seed.ts fills the panels until the
 * backend is up. Production must NOT set this var.
 *
 * On Deno Deploy the frontend + backend are the same process (mod.ts routes
 * `/me` to the backend handler), so we self-fetch the same origin instead
 * of the dev `BACKEND_URL=http://localhost:3000` default. Falling back to a
 * non-existent localhost would 500 every SSR'd page.
 */
const DEV_USER: User = { id: "dev", phoneNumber: "+15125550000", name: "Diego", language: "en", createdAt: 0, updatedAt: 0 };

function sameOriginBaseUrl(req: Request): string | undefined {
  try { return new URL(req.url).origin; }
  catch { return undefined; }
}

export async function loadUser(req: Request): Promise<User | undefined> {
  const sessionId = readSessionCookie(req.headers.get("cookie"));
  if (!sessionId) {
    if (DEV_BYPASS) return DEV_USER;
    return undefined;
  }

  // Prefer the same-origin URL (works on Deno Deploy where mod.ts is the
  // single entry); api.get falls back to BACKEND_URL only when no baseUrl
  // is supplied, which works for local dev.
  const baseUrl = sameOriginBaseUrl(req);

  try {
    return await api.get<User>("/me", { sessionId, ...(baseUrl ? { baseUrl } : {}) });
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return undefined;
    if (DEV_BYPASS) return DEV_USER;
    // Backend unreachable / network error — treat as "no session" so the
    // middleware can redirect to /verify instead of bubbling a 500. Real
    // auth errors above (401/403) already returned undefined; this catch
    // is for transport-level failures (DNS, connect refused, timeouts).
    console.error("[loadUser] backend lookup failed:", (err as Error).message);
    return undefined;
  }
}

export function getSessionId(req: Request): string | undefined {
  return readSessionCookie(req.headers.get("cookie"));
}
