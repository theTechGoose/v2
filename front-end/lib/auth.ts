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

type BackendFetch = (req: Request) => Response | Promise<Response>;

/** In-process backend handler set by /v2/mod.ts on Deno Deploy boot. When
 *  present, SSR dispatches /me directly to the backend without HTTP — the
 *  public URL self-fetch returns 508 (Loop Detected) on Deno Deploy. */
function getInProcessBackend(): BackendFetch | undefined {
  return (globalThis as { __backendFetch?: BackendFetch }).__backendFetch;
}

async function fetchMeInProcess(handler: BackendFetch, sessionId: string): Promise<User | undefined> {
  const probe = new Request("http://internal/me", {
    method: "GET",
    headers: { "x-session-id": sessionId, "accept": "application/json" },
  });
  const res = await handler(probe);
  if (res.status === 401 || res.status === 403) return undefined;
  if (!res.ok) throw new Error(`/me failed: ${res.status}`);
  return await res.json() as User;
}

export async function loadUser(req: Request): Promise<User | undefined> {
  const sessionId = readSessionCookie(req.headers.get("cookie"));
  if (!sessionId) {
    if (DEV_BYPASS) return DEV_USER;
    return undefined;
  }

  // Same-process dispatch on Deno Deploy. Falls back to api.get (over the
  // dev proxy / BACKEND_URL) when running outside the composed mod.ts.
  const inProcess = getInProcessBackend();

  try {
    if (inProcess) return await fetchMeInProcess(inProcess, sessionId);
    return await api.get<User>("/me", { sessionId });
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

/**
 * Profile completeness gate.
 *
 * Returns the loaded user plus a flag indicating whether onboarding
 * info (name + businessName) is complete. Used by authed-route
 * middlewares to redirect to /assistant?onboard=1 when missing.
 *
 * Reads `/profile` (the composite endpoint) for businessName so we
 * don't have to keep two stores in sync. Network errors → treats as
 * "incomplete" so the user lands on the assistant rather than getting
 * a half-broken dashboard with no name.
 */
export type OnboardingMissing = "name" | "business" | "state";

export interface ProfileGate {
  user: User | undefined;
  businessName: string | undefined;
  state: string | undefined;
  isComplete: boolean;
  missing: OnboardingMissing[];
}

export async function loadProfileGate(req: Request): Promise<ProfileGate> {
  const user = await loadUser(req);
  if (!user) return { user: undefined, businessName: undefined, state: undefined, isComplete: false, missing: [] };
  const sessionId = readSessionCookie(req.headers.get("cookie"));
  let businessName: string | undefined;
  let state: string | undefined;
  if (sessionId) {
    try {
      const inProcess = getInProcessBackend();
      if (inProcess) {
        const probe = new Request("http://internal/profile", {
          method: "GET",
          headers: { "x-session-id": sessionId, "accept": "application/json" },
        });
        const res = await inProcess(probe);
        if (res.ok) {
          const j = await res.json() as {
            identity?: { businessName?: string; legalName?: string };
            address?:  { state?: string };
          };
          businessName = j.identity?.businessName?.trim() || j.identity?.legalName?.trim();
          state = j.address?.state?.trim();
        }
      } else {
        const j = await api.get<{
          identity?: { businessName?: string; legalName?: string };
          address?:  { state?: string };
        }>("/profile", { sessionId });
        businessName = j.identity?.businessName?.trim() || j.identity?.legalName?.trim();
        state = j.address?.state?.trim();
      }
    } catch (err) {
      // Profile lookup failed — treat as missing so we surface the
      // onboarding chat rather than letting the user land on a
      // dashboard with no brand identity.
      console.error("[loadProfileGate] profile lookup failed:", (err as Error).message);
    }
  }
  const missing: OnboardingMissing[] = [];
  if (!user.name || user.name.trim().length === 0) missing.push("name");
  if (!businessName) missing.push("business");
  if (!state) missing.push("state");
  return { user, businessName, state, isComplete: missing.length === 0, missing };
}
