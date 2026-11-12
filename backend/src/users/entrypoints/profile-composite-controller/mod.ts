import { Context, Controller, Get, Param } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { LoadProfile } from "@profile/domain/coordinators/load-profile/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireSession } from "@users/domain/coordinators/require-user/mod.ts";
import { AccountAdmins } from "@users/domain/coordinators/account-admins/mod.ts"; // REQ-624
import { computeInitials } from "@profile/domain/business/initials/mod.ts";

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
    private accountAdmins: AccountAdmins,
  ) {}

  /**
   * The account's snapshot. REQ-624: while acting, `actor` names the person signed in and the
   * avatar `initials` are hers; the business (identity, logo, everything else) stays the owner's.
   */
  @Get()
  async getMine(@Context() ctx: ExecutionContext) {
    const { user, actor } = await requireSession(ctx, this.sessions, this.users);
    const snapshot = await this.loader.load(user.id);
    if (!actor) return snapshot;
    const view = await this.accountAdmins.actorView(actor, user.id, user); // REQ-631: with her language
    // no name yet (her phone stands in): no letters to show — the sidebar draws its dot
    return { ...snapshot, actor: view, initials: view.needsName ? "?" : computeInitials(view.name) };
  }

  @Get(":userId/public")
  async getPublic(@Param("userId") userId: string) {
    return await this.loader.loadPublic(userId);
  }
}
