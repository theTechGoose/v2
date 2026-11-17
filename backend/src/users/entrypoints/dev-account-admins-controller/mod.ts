/**
 * REQ-632 — the fakes-only seam for a LEGACY editor invite. The invite API now requires the
 * editor's name, but invites made before that sit in the store without one, and the REQ-624 name
 * prompt is their fallback. `POST /dev/account-admins/legacy-invite { phoneNumber }` (the owner's
 * session) plants such a record, no text sent, so a browser story can still reach that prompt.
 * Off the real deploy only (REQ-318's one switch): there it is a 404, like the dev Stripe seam.
 */
import { Body, Context, Controller, Post } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { onRealDeploy } from "@core/business/real-deploy/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireOwner } from "@users/domain/coordinators/require-user/mod.ts";
import { AccountAdmins } from "@users/domain/coordinators/account-admins/mod.ts";

@Controller("dev/account-admins")
export class DevAccountAdminsController {
  constructor(private admins: AccountAdmins, private users: UserStore, private sessions: SessionStore) {}

  @Post("legacy-invite")
  async legacyInvite(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    if (onRealDeploy()) return ctx.json({ error: "not_found" }, 404);
    const owner = await requireOwner(ctx, this.sessions, this.users);
    const phone = (body && typeof body === "object" ? body : {}) as { phoneNumber?: unknown };
    return ctx.json(await this.admins.plantLegacyInvite(owner, phone.phoneNumber), 201);
  }
}
