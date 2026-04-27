import "#reflect-metadata";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { loadConfig } from "./config.ts";
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

const config = loadConfig();
const server = await bootstrapServer(AppModule, { port: config.port, swagger: false });
await server.listen();
console.log(`backendv2 listening on http://localhost:${config.port}`);
