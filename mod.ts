import backend from "./backend/bootstrap/mod.ts";
import frontend from "./front-end/_fresh/server.js";

// Expose the backend handler on a known global so SSR (loadUser, future
// route loaders) can dispatch in-process instead of self-fetching the
// public URL. Deno Deploy returns 508 (Loop Detected) on self-fetch from
// a worker, so HTTP is not an option for same-origin calls. Using a
// bare-import of the backend module from the front-end would pull
// server-only deps (decorators, openai SDK, etc.) into the Vite SSR
// bundle, hence the global.
(globalThis as { __backendFetch?: typeof backend.fetch }).__backendFetch =
  backend.fetch.bind(backend);

const frontendFetch = (frontend as unknown as {
  fetch: (
    req: Request,
    info: Deno.ServeHandlerInfo,
  ) => Response | Promise<Response>;
}).fetch;

/**
 * Composed prod router — NO hand-maintained path lists.
 *
 * The old BACKEND_PREFIXES / FRONTEND_OVERRIDES pair was a standing bug
 * class: any frontend page added under a backend-owned prefix was silently
 * shadowed in prod only (the /customers page rendered locally but dumped
 * the backend's JSON on paperworkmonster.com), and any backend namespace
 * missing from the list (e.g. /cron) 404'd for external callers. Dev never
 * runs this file, so the drift was invisible until production.
 *
 * Routing is now structural:
 *   1. /api/geocode      → frontend (literal Fresh route holding MAPBOX_TOKEN;
 *                          must not be swallowed by the /api dispatch).
 *   2. /api/<path>       → backend, with /api stripped. The /api prefix IS
 *                          the "dispatch to the backend" signal for islands.
 *   3. everything else   → frontend first; if (and only if) Fresh answers
 *                          404, retry the backend at the same path; if the
 *                          backend also 404s, return the frontend's styled
 *                          404 page. A new frontend page therefore always
 *                          wins automatically, and every backend route stays
 *                          reachable at the domain root — no lists to forget.
 */
export default {
  async fetch(
    req: Request,
    info: Deno.ServeHandlerInfo,
  ): Promise<Response> {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // Literal frontend /api routes (see routes/api/geocode.ts) — in dev
    // Vite serves them ahead of the proxy, so without this carve-out they
    // work locally and 404 in prod.
    if (pathname === "/api/geocode") {
      return await frontendFetch(req, info);
    }

    // Frontend islands call `/api/<backend-path>`; strip the prefix and
    // dispatch in-process. An unknown path 404s from the backend router,
    // which is the correct answer for an API miss.
    if (pathname.startsWith("/api/")) {
      const rewritten = new URL(req.url);
      rewritten.pathname = pathname.slice(4);
      return await backend.fetch(new Request(rewritten, req));
    }

    // Frontend-first with backend fallthrough. Requests with a body are
    // cloned so the backend retry still has one after Fresh consumed (or
    // ignored) the original.
    const backendReq = req.body ? req.clone() : req;
    const fromFrontend = await frontendFetch(req, info);
    if (fromFrontend.status !== 404) return fromFrontend;

    const fromBackend = await backend.fetch(backendReq);
    if (fromBackend.status !== 404) {
      // The frontend 404 response is abandoned — release its body.
      await fromFrontend.body?.cancel();
      return fromBackend;
    }

    // Neither side knows the path: show the human the styled frontend 404,
    // never the backend's JSON error.
    await fromBackend.body?.cancel();
    return fromFrontend;
  },
};
