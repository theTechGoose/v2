import backend from "./backend/bootstrap/mod.ts";
import frontend from "./front-end/_fresh/server.js";
import { composeRouter } from "./compose-router.ts";

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
 * Composed prod router — the rules live in compose-router.ts (proved by
 * backend/src/core/entrypoints/compose-router/test.ts): /api/geocode to the
 * frontend, a WebSocket upgrade under /api to the backend untouched, /api/<path>
 * to the backend stripped, everything else frontend-first with the backend as
 * the fallthrough and the frontend's styled 404 last.
 */
export default {
  fetch: composeRouter({
    backendFetch: (req) => backend.fetch(req),
    frontendFetch,
  }),
};
