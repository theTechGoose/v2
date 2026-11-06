import { Module } from "#danet/core";
import { UsersModule } from "@users/mod-root.ts";
import { DemoModeController } from "@demo-mode/entrypoints/demo-mode-controller/mod.ts";
import { DemoModeSocketController } from "@demo-mode/entrypoints/demo-mode-socket-controller/mod.ts";
import { DemoSessionStore } from "@demo-mode/domain/data/demo-session-store/mod.ts";
import { DemoHub } from "@demo-mode/domain/coordinators/demo-hub/mod.ts";
import { DemoAccess } from "@demo-mode/domain/coordinators/demo-access/mod.ts";

/** REQ-153 — demo mode: a super admin's live pointer on a user's screen, signaled through this deploy. */
@Module({
  imports: [UsersModule],
  controllers: [DemoModeController, DemoModeSocketController],
  injectables: [DemoSessionStore, DemoHub, DemoAccess],
})
export class DemoModeModule {}
