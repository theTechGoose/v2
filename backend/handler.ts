import "#reflect-metadata";
import { DanetApplication, Module } from "#danet/core";
import { UsersModule } from "@users/mod-root.ts";
import { AgentsModule } from "@agents/mod-root.ts";
import { CrmModule } from "@crm/mod-root.ts";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { CommunicationModule } from "@communication/mod-root.ts";
import { CoreModule } from "@core/mod-root.ts";

@Module({
  imports: [
    UsersModule,
    AgentsModule,
    CrmModule,
    PaperworkModule,
    CommunicationModule,
    CoreModule,
  ],
})
class AppModule {}

const app = new DanetApplication();
await app.init(AppModule);

const hono = (app as unknown as {
  app: { fetch: (req: Request, env?: unknown, ctx?: unknown) => Response | Promise<Response> };
}).app;

export const fetch = hono.fetch.bind(hono);
export default { fetch };
