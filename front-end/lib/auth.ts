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

const DEV_BYPASS = (typeof Deno !== "undefined"
  ? (Deno.env.get("DEV_BYPASS_AUTH") ?? "1")
  : "0") === "1";

/**
 * Resolve the current user from the request's pm_session cookie.
 * Returns undefined if the cookie is missing OR the backend says it's invalid (401/403).
 *
 * If the backend is unreachable AND DEV_BYPASS_AUTH=1 (default during dev),
 * returns a placeholder user so SSR can render the shell — the seed data in
 * /lib/dash-seed.ts and /lib/assistant-seed.ts fills the panels until the
 * backend is up. Set DEV_BYPASS_AUTH=0 to enforce strict auth.
 */
export async function loadUser(req: Request): Promise<User | undefined> {
  const sessionId = readSessionCookie(req.headers.get("cookie"));
  if (!sessionId) return undefined;

  try {
    return await api.get<User>("/me", { sessionId });
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return undefined;
    if (DEV_BYPASS) {
      // Backend unreachable but cookie present — render the shell with a stub.
      return { id: "dev", phoneNumber: "+15125550000", name: "Diego", language: "en", createdAt: 0, updatedAt: 0 };
    }
    throw err;
  }
}

export function getSessionId(req: Request): string | undefined {
  return readSessionCookie(req.headers.get("cookie"));
}
