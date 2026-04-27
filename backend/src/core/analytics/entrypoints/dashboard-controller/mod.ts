import { Context, Controller, Get } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { ComputeDashboardStats } from "@analytics/domain/coordinators/compute-dashboard-stats/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/entrypoints/auth-helpers.ts";

@Controller("analytics")
export class DashboardController {
  constructor(
    private flow: ComputeDashboardStats,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  /** GET /analytics/dashboard — single payload that drives the dashboard hero + KPIs + sparkline + sidebar badges. */
  @Get("dashboard")
  async dashboard(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.flow.run(user.id);
  }
}
