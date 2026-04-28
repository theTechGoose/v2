/**
 * Generic backend proxy. Forwards `/api/<anything>` to the Danet backend at
 * BACKEND_URL with the user's session cookie attached. Used by every island
 * client (assistantClient, dashboardClient, ...) — without this, browser-side
 * fetches to `/api/agents/chat` 404 on Vite.
 */
import { define } from "../../utils.ts";

const BACKEND_URL = Deno.env.get("BACKEND_URL") ?? "http://localhost:3000";

const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailers", "transfer-encoding", "upgrade", "host", "content-length",
]);

async function forward(req: Request, path: string): Promise<Response> {
  const url = new URL(req.url);
  const target = `${BACKEND_URL}/${path}${url.search}`;

  const headers = new Headers();
  for (const [k, v] of req.headers.entries()) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) headers.set(k, v);
  }

  const init: RequestInit = { method: req.method, headers };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.arrayBuffer();
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "backend_unreachable" }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }

  const respHeaders = new Headers();
  for (const [k, v] of upstream.headers.entries()) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) respHeaders.set(k, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
}

export const handler = define.handlers({
  GET: (ctx) => forward(ctx.req, ctx.params.path),
  POST: (ctx) => forward(ctx.req, ctx.params.path),
  PUT: (ctx) => forward(ctx.req, ctx.params.path),
  PATCH: (ctx) => forward(ctx.req, ctx.params.path),
  DELETE: (ctx) => forward(ctx.req, ctx.params.path),
});
