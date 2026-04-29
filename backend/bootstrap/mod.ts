import "#reflect-metadata";
import { DanetApplication, Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { loadConfig } from "./config.ts";
import { UsersModule } from "@users/mod-root.ts";
import { AgentsModule } from "@agents/mod-root.ts";
import { CrmModule } from "@crm/mod-root.ts";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { CommunicationModule } from "@communication/mod-root.ts";
import { FilesModule } from "@files/mod-root.ts";
import { AnalyticsModule } from "@analytics/mod-root.ts";

@Module({
  imports: [
    UsersModule,
    AgentsModule,
    CrmModule,
    PaperworkModule,
    CommunicationModule,
    FilesModule,
    AnalyticsModule,
  ],
})
class AppModule {}

/**
 * Worker-style entry: build a Danet app and expose its underlying Hono
 * `fetch` so the composed root (`/v2/mod.ts`) can route requests through
 * the backend without spinning up an HTTP listener.
 */
const app = new DanetApplication();
await app.init(AppModule);

const hono = (app as unknown as {
  app: {
    fetch: (req: Request, env?: unknown, ctx?: unknown) => Response | Promise<Response>;
    // Hono middleware signature — keep loose so we don't have to import hono types.
    // deno-lint-ignore no-explicit-any
    use: (handler: (c: any, next: () => Promise<void>) => unknown) => unknown;
  };
}).app;

function setCorsHeaders(headers: Headers, origin: string, reqHeaders: string): void {
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-credentials", "true");
  headers.set("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  headers.set("access-control-allow-headers", reqHeaders);
  headers.set("access-control-expose-headers", "set-cookie, x-session-id");
  headers.append("vary", "Origin");
}

// Monkey-patch hono.fetch with an outer CORS layer. Hono auto-responds
// to OPTIONS based on registered routes BEFORE any user middleware runs,
// so wrapping at the request boundary is the only place we control all
// responses. This is what mod.ts (worker mode) AND bootstrapServer
// (standalone mode) both end up calling.
const innerFetch = hono.fetch.bind(hono);
hono.fetch = ((req: Request, env?: unknown, ctx?: unknown): Response | Promise<Response> => {
  const origin = req.headers.get("origin") ?? "*";
  const reqHeaders = req.headers.get("access-control-request-headers")
    ?? "content-type, x-session-id, accept";
  if (req.method === "OPTIONS") {
    const headers = new Headers();
    setCorsHeaders(headers, origin, reqHeaders);
    return new Response(null, { status: 204, headers });
  }
  return Promise.resolve(innerFetch(req, env, ctx)).then((res) => {
    const headers = new Headers(res.headers);
    setCorsHeaders(headers, origin, reqHeaders);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  });
}) as typeof hono.fetch;

export const fetch = hono.fetch.bind(hono);
export default { fetch };

/**
 * Standalone entry: when this file is run directly (`deno run … bootstrap/mod.ts`),
 * also start the Hono HTTP listener on the configured port. The composed
 * root imports this module and never sets `import.meta.main`, so the
 * worker path stays a no-op for it.
 */
if (import.meta.main) {
  const config = loadConfig();
  // Serve through the SAME monkey-patched hono.fetch so CORS applies
  // in standalone mode too. bootstrapServer would create a separate
  // app instance, bypassing our patch.
  Deno.serve({ port: config.port, hostname: "0.0.0.0" }, (req) => hono.fetch(req));
  console.log(`backendv2 listening on http://localhost:${config.port}`);
}
