/**
 * The deploy's root router, as a function of its two handlers so it can be proved in a test
 * (backend/src/core/entrypoints/compose-router/test.ts) without the built frontend.
 *
 * NO hand-maintained path lists. The old BACKEND_PREFIXES / FRONTEND_OVERRIDES pair was a
 * standing bug class: any frontend page added under a backend-owned prefix was silently shadowed
 * in prod only, and any backend namespace missing from the list 404'd for external callers. Dev
 * never runs this file, so the drift was invisible until production. Routing is structural:
 *
 *   1. /api/geocode      → frontend (literal Fresh route holding MAPBOX_TOKEN; must not be
 *                          swallowed by the /api dispatch).
 *   2. a WebSocket upgrade under /api/… → backend with the ORIGINAL request, path untouched
 *                          (REQ-153: `Deno.upgradeWebSocket` ties the upgrade to the request
 *                          the server handed us — a `new Request(url, req)` copy negotiates a
 *                          socket whose frames the client rejects, "Reserved bits are not zero").
 *                          A socket controller therefore lives at `api/<name>` in the backend.
 *   3. /api/<path>       → backend, with /api stripped. The /api prefix IS the "dispatch to the
 *                          backend" signal for islands.
 *   4. everything else   → frontend first; if (and only if) Fresh answers 404, retry the backend
 *                          at the same path; if the backend also 404s, return the frontend's
 *                          styled 404 page. A new frontend page therefore always wins
 *                          automatically, and every backend route stays reachable at the domain
 *                          root — no lists to forget.
 */
export interface RouterParts {
  backendFetch: (req: Request) => Response | Promise<Response>;
  frontendFetch: (
    req: Request,
    info: Deno.ServeHandlerInfo,
  ) => Response | Promise<Response>;
}

export function isWebSocketUpgrade(req: Request): boolean {
  return req.headers.get("upgrade")?.toLowerCase() === "websocket";
}

export function composeRouter({ backendFetch, frontendFetch }: RouterParts) {
  return async (
    req: Request,
    info: Deno.ServeHandlerInfo,
  ): Promise<Response> => {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // Literal frontend /api routes (see routes/api/geocode.ts) — in dev Vite serves them ahead of
    // the proxy, so without this carve-out they work locally and 404 in prod.
    if (pathname === "/api/geocode") {
      return await frontendFetch(req, info);
    }

    if (pathname.startsWith("/api/")) {
      // REQ-153 — an upgrade keeps the request object (and its path).
      if (isWebSocketUpgrade(req)) return await backendFetch(req);
      // Frontend islands call `/api/<backend-path>`; strip the prefix and dispatch in-process. An
      // unknown path 404s from the backend router, which is the correct answer for an API miss.
      const rewritten = new URL(req.url);
      rewritten.pathname = pathname.slice(4);
      return await backendFetch(new Request(rewritten, req));
    }

    // Frontend-first with backend fallthrough. Requests with a body are cloned so the backend
    // retry still has one after Fresh consumed (or ignored) the original.
    const backendReq = req.body ? req.clone() : req;
    const fromFrontend = await frontendFetch(req, info);
    if (fromFrontend.status !== 404) return fromFrontend;

    const fromBackend = await backendFetch(backendReq);
    if (fromBackend.status !== 404) {
      // The frontend 404 response is abandoned — release its body.
      await fromFrontend.body?.cancel();
      return fromBackend;
    }

    // Neither side knows the path: show the human the styled frontend 404, never the backend's
    // JSON error.
    await fromBackend.body?.cancel();
    return fromFrontend;
  };
}
