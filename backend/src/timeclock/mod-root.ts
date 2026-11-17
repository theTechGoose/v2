import { Module } from "#danet/core";
import { UsersModule } from "@users/mod-root.ts";
import { FieldModule } from "@field/mod-root.ts";
import {
  TimeclockController,
  TimeclockWorkerController,
} from "@timeclock/entrypoints/timeclock-controllers/mod.ts";
import { PunchStore } from "@timeclock/domain/data/punch-store/mod.ts";

/** REQ-192 — the timeclock: a worker's punches (the field module's workers and their sessions), the office's timesheet. */
@Module({
  imports: [UsersModule, FieldModule],
  controllers: [TimeclockWorkerController, TimeclockController],
  injectables: [PunchStore],
})
export class TimeclockModule {}
