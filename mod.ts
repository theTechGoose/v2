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

const BACKEND_PREFIXES = [
  "/agents",
  "/auth",
  "/me",
  "/conversations",
  "/messages",
  "/notifications",
  "/email",
  "/accounts",
  "/customers",
  "/entries",
  "/quotes",
  "/invoices",
  "/contracts",
  "/payment-terms",
  "/views",
  "/profile",
  "/analytics",
  "/jobs",
  "/search",
  "/files",
  // Session-gated manual cron triggers (POST /cron/run-reminders etc.) —
  // an external scheduler calls these at the domain root, so without this
  // entry the frontend 404s them before they ever reach backend auth.
  "/cron",
];

function matchesBackend(pathname: string): boolean {
  return BACKEND_PREFIXES.some((p) =>
    pathname === p || pathname.startsWith(p + "/")
  );
}

// Path prefixes that the FRONTEND owns even though they overlap a backend
// route. The backend is still reachable via /api/<path>; we just block
// direct (non-/api) access so the Fresh page renders for the human.
const FRONTEND_OVERRIDES = [
  "/quotes",
  "/clients",
  "/customers",
  "/invoices",
  "/contracts",
  "/messages",
];

function isFrontendOverride(pathname: string): boolean {
  return FRONTEND_OVERRIDES.some((p) =>
    pathname === p || pathname.startsWith(p + "/")
  );
}

export default {
  fetch(req: Request, info: Deno.ServeHandlerInfo): Response | Promise<Response> {
    const url = new URL(req.url);
    let pathname = url.pathname;

    // A few /api/* routes are implemented by the FRONTEND itself (literal
    // Fresh routes that must not be swallowed by the backend dispatch below
    // — in dev Vite serves them first, so without this carve-out they work
    // locally and 404 in prod). /api/geocode is the server-side Mapbox
    // proxy holding MAPBOX_TOKEN.
    if (pathname === "/api/geocode") {
      return (frontend as unknown as {
        fetch: (
          req: Request,
          info: Deno.ServeHandlerInfo,
        ) => Response | Promise<Response>;
      }).fetch(req, info);
    }

    // Frontend islands call `/api/<backend-path>`; the `/api` prefix IS the
    // "dispatch to the backend" signal, so strip it and hand EVERY such
    // request to the in-process backend handler. This used to be gated on
    // `matchesBackend(stripped)`, which meant any backend namespace missing
    // from BACKEND_PREFIXES (e.g. /clients, /payments) fell through to the
    // Fresh dev proxy in routes/api/[...path].ts → fetch(BACKEND_URL) →
    // http://localhost:3000, which is dead in the composed prod server and
    // 502s with `backend_unreachable`. Routing all /api/* in-process kills
    // that footgun; an unknown path simply 404s from the backend router,
    // which is the correct answer anyway.
    if (pathname.startsWith("/api/")) {
      const rewritten = new URL(req.url);
      rewritten.pathname = pathname.slice(4);
      return backend.fetch(new Request(rewritten, req));
    }

    if (matchesBackend(pathname) && !isFrontendOverride(pathname)) {
      return backend.fetch(req);
    }
    return (frontend as unknown as { fetch: (req: Request, info: Deno.ServeHandlerInfo) => Response | Promise<Response> }).fetch(req, info);
  },
};
