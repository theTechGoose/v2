import { Context, Controller, Get } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { ListActiveJobs } from "@analytics/domain/coordinators/list-active-jobs/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";

@Controller("jobs")
export class JobsController {
  constructor(
    private flow: ListActiveJobs,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  /**
   * GET /jobs
   *
   * Synthesized view across customer + quote + contract + invoice for
   * the dashboard's "Active jobs" panel. No own storage — recomputed
   * on every read.
   */
  @Get()
  async list(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return ctx.json(await this.flow.run(user.id));
  }
}
