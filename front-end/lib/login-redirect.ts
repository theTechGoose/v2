/**
 * REQ-1153 (LOOP-007 cycle 3, q3-82) — one answer to "no session on an app page": /login with the
 * page asked for as `?next=` (the same answer client.ts gives a client-side 401, P-35), and after
 * the code the tab goes back to that page.
 *
 *  - `loginRedirect(url)` is what every authed `_middleware.ts` returns when `loadUser()` finds no
 *    session: a 302 to `/login?next=<path+search, encoded>`. A path that is not a plain site path
 *    (`//host…`, a backslash) is dropped — the visitor still lands on /login, just without next.
 *  - `safeNext(next)` is the shared site-path rule (REQ-879's `rejoinTarget`): a path on this
 *    site, never a sign-in page (/login, /verify), never `//` or a backslash.
 *  - `afterCodeTarget(redirectTo, next)` is where CodeInput goes after a good code: `next` when the
 *    backend's landing is the plain dashboard (`/dashboard`, `/dashboard?welcome=back`); any other
 *    landing — the REQ-091 onboarding wizard `/welcome` above all — wins over `next`.
 */

/** `next` when it is a path on this site that is not a sign-in page, else null */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return null;
  if (next.includes("\\")) return null;
  try {
    const u = new URL(next, "http://app.invalid");
    if (u.origin !== "http://app.invalid") return null;
    if (/^\/(login|verify)(\/|$)/.test(u.pathname)) return null;
    return u.pathname + u.search + u.hash;
  } catch {
    return null;
  }
}

/** the /login address that brings the visitor back to `next` after the code */
export function loginHref(next: string | null | undefined): string {
  const safe = safeNext(next);
  return safe ? `/login?next=${encodeURIComponent(safe)}` : "/login";
}

/** a 302 to /login?next=<the page asked for> — the authed gates' "no session" answer */
export function loginRedirect(url: URL): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: loginHref(url.pathname + url.search) },
  });
}

/** where the tab goes after a good code: `next` over the plain dashboard landing */
export function afterCodeTarget(
  redirectTo: string,
  next: string | null | undefined,
): string {
  const safe = safeNext(next);
  if (!safe) return redirectTo;
  let path: string;
  try {
    path = new URL(redirectTo, "http://app.invalid").pathname;
  } catch {
    return redirectTo;
  }
  return path === "/dashboard" ? safe : redirectTo;
}
