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
  app: { fetch: (req: Request, env?: unknown, ctx?: unknown) => Response | Promise<Response> };
}).app;

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
  const server = await bootstrapServer(AppModule, { port: config.port, swagger: false });
  await server.listen();
  console.log(`backendv2 listening on http://localhost:${config.port}`);
}
