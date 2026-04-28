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
    if (matchesBackend(url.pathname)) {
      return backend.fetch(req);
    }
    return (frontend as { fetch: (req: Request, info: Deno.ServeHandlerInfo) => Response | Promise<Response> }).fetch(req, info);
  },
};
