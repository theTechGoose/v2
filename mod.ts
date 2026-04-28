import backend from "./backend/handler.ts";
import frontend from "./front-end/_fresh/server.js";

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
];

function matchesBackend(pathname: string): boolean {
  return BACKEND_PREFIXES.some((p) =>
    pathname === p || pathname.startsWith(p + "/")
  );
}

export default {
  fetch(req: Request, info: Deno.ServeHandlerInfo): Response | Promise<Response> {
    const url = new URL(req.url);
    let pathname = url.pathname;

    // Frontend islands call `/api/<backend-path>`; strip the `/api` prefix
    // and let the backend match it via its existing controller routes.
    if (pathname.startsWith("/api/")) {
      const stripped = pathname.slice(4);
      if (matchesBackend(stripped)) {
        const rewritten = new URL(req.url);
        rewritten.pathname = stripped;
        return backend.fetch(new Request(rewritten, req));
      }
    }

    if (matchesBackend(pathname)) {
      return backend.fetch(req);
    }
    return (frontend as { fetch: (req: Request, info: Deno.ServeHandlerInfo) => Response | Promise<Response> }).fetch(req, info);
  },
};
