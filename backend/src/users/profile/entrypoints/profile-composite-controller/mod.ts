import { Context, Controller, Get, Param } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { LoadProfile } from "@profile/domain/coordinators/load-profile/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/entrypoints/auth-helpers.ts";

/**
 * Composite profile reads.
 *
 *   GET /profile                    (auth) — full snapshot for /dashboard/settings
 *   GET /profile/:userId/public     (no auth) — safe subset for customer-facing pages
 *
 * The two endpoints are intentionally split so the public route can never
 * accidentally leak private aggregates.
 */
@Controller("profile")
export class ProfileCompositeController {
  constructor(
    private loader: LoadProfile,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  @Get()
  async getMine(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.loader.load(user.id);
  }

  @Get(":userId/public")
  async getPublic(@Param("userId") userId: string) {
    return await this.loader.loadPublic(userId);
  }
}
