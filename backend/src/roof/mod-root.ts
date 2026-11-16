import { Module } from "#danet/core";
import { UsersModule } from "@users/mod-root.ts";
import { RoofController } from "@roof/entrypoints/roof-controller/mod.ts";
import { RoofMeasurementStore } from "@roof/domain/data/roof-store/mod.ts";
import { RoofSources } from "@roof/domain/data/roof-sources/mod.ts";

/** REQ-856 — roof measurement from free aerial imagery: locate an address, serve the window, keep the account's measurements. */
@Module({
  imports: [UsersModule],
  controllers: [RoofController],
  injectables: [RoofMeasurementStore, RoofSources],
})
export class RoofModule {}
