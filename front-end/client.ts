// Import CSS files here for hot module reloading to work.
import "./assets/styles.css";

/**
 * P-35 session-expiry seam (cypress/e2e/session-expiry-errors.cy.ts).
 *
 * This module is Fresh's browser entry (`fresh:client-entry` wraps it), so it
 * runs on every page BEFORE islands hydrate — which makes it the one shared
 * seam covering every island fetch, including islands that call `fetch()`
 * directly instead of going through lib/api.ts.
 *
 * When an island's /api call comes back 401 while the user is on an
 * authenticated app surface, the session has expired (the backend now maps
 * UnauthorizedError → 401). Reacting island-by-island would just reproduce
 * the generic "Couldn't apply discount."-style copy everywhere, so instead:
 * redirect to /login, preserving the current path as ?next=.
 *
 * Scoped deliberately:
 *  - only same-origin /api/* requests (the proxy every island client uses);
 *  - only while on an authed app route — public surfaces (landing, /login,
 *    /verify, public doc pages) are never hijacked by a stray 401.
 * On redirect the returned promise never settles: the page is navigating
 * away, and settling would let the caller flash its generic error copy first.
 */
const AUTHED_ROUTE_PREFIXES = [
  "/dashboard",
  "/invoices",
  "/quotes",
  "/clients",
  "/payments",
  "/messages",
  "/settings",
  "/assistant",
  "/admin",
  "/accounts-manager",
  "/welcome",
];

function isAuthedAppRoute(pathname: string): boolean {
  return AUTHED_ROUTE_PREFIXES.some((p) =>
    pathname === p || pathname.startsWith(`${p}/`)
  );
}

/** True when `input` targets this origin's /api/* proxy. */
function isApiRequest(input: RequestInfo | URL): boolean {
  try {
    const raw = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.href
      : input.url;
    const url = new URL(raw, globalThis.location.origin);
    if (url.origin !== globalThis.location.origin) return false;
    return url.pathname === "/api" || url.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

if (typeof document !== "undefined") {
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> =>
    originalFetch(input, init).then((res) => {
      if (
        res.status === 401 && isApiRequest(input) &&
        isAuthedAppRoute(globalThis.location.pathname)
      ) {
        const here = globalThis.location.pathname + globalThis.location.search;
        globalThis.location.assign(`/login?next=${encodeURIComponent(here)}`);
        // Navigating away — never settle (see doc comment above).
        return new Promise<Response>(() => {});
      }
      return res;
    })) as typeof globalThis.fetch;
}
