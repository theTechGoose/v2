import {
  Body,
  Context,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
} from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { Impersonate } from "@users/domain/coordinators/impersonate/mod.ts";
import { BootstrapSuperAdmin } from "@users/domain/coordinators/bootstrap-super-admin/mod.ts";
import { requireSuperAdmin } from "@users/domain/coordinators/require-super-admin/mod.ts";
import { isFeatureKey } from "#features";
import {
  readSessionId,
  requireUser,
  UnauthorizedError,
} from "@users/domain/coordinators/require-user/mod.ts";
import {
  adminSearchMatches,
  type AdminUserView,
  projectAdminUser,
} from "@users/domain/business/admin-user-view/mod.ts";
import { buildSessionCookie } from "@users/domain/business/session-cookie/mod.ts";
import { LANDING_OFFER } from "#quote-flow/landing-offers.ts";
import { accountForPick } from "#quote-flow/merchant-accounts.ts";
import { PlanStore } from "@users/domain/data/plan-store/mod.ts";
import { CrmLeadCapture } from "@users/domain/coordinators/crm-lead-capture/mod.ts";
import { chosen, merchantOf, planOf } from "@users/domain/business/plan/mod.ts";
import type { PlanId } from "@users/dto/plan.ts";

/** REQ-507 — the most rows a non-blank /admin users search returns (as the blank list) */
const ADMIN_SEARCH_LIMIT = 25;

/**
 * /admin — super-admin-only surface. EVERY mutating/listing endpoint calls
 * requireSuperAdmin() so the super-admin check is enforced server-side and
 * the client is never trusted for it.
 *
 * The two exceptions are deliberately scoped narrower-than-admin:
 *   - /admin/whoami            any valid session (returns its own context)
 *   - /admin/stop-impersonating  any impersonation session (reverts itself)
 *   - /admin/bootstrap         cold-start gate (dev-open / prod-token)
 */
@Controller("admin")
export class AdminController {
  constructor(
    private users: UserStore,
    private sessions: SessionStore,
    private identities: BusinessIdentityStore,
    private impersonate: Impersonate,
    private bootstrap: BootstrapSuperAdmin,
    private plans: PlanStore,
    private leads: CrmLeadCapture,
  ) {}

  /**
   * REQ-131 — POST /admin/users/:id/settle-watch { dueId, planId, merchant? }: a watch on a due the
   * CRM holds (paid or not) for the plan it was minted for. The sweep carries it like the watch a
   * mint sets: settled, that plan is active — restored over a later unpaid pick that buried it
   * (Alex: $99 Monster paid, three re-picks, a $399 Assist+ due on the record). The repair IS the
   * fix's code path, never a hand edit. Super admin only.
   */
  @Post("users/:id/settle-watch")
  async settleWatch(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    await requireSuperAdmin(ctx, this.sessions, this.users);
    const b = (body ?? {}) as {
      dueId?: unknown;
      planId?: unknown;
      merchant?: unknown;
    };
    const dueId = typeof b.dueId === "string" ? b.dueId.trim() : "";
    const planId = typeof b.planId === "string" ? b.planId.trim() : "";
    if (!dueId || !planId) {
      throw Object.assign(
        new Error(
          "settle-watch-invalid: body.dueId and body.planId (the plan the due was minted for) are required",
        ),
        { status: 400 },
      );
    }
    const plan = planOf(planId); // plan-unknown → 400
    if (plan.id === "free") {
      throw Object.assign(new Error("settle-watch-invalid: free has no due"), {
        status: 400,
      });
    }
    await this.users.get(id);
    const current = await this.plans.get(id);
    const pick = chosen(id, plan.id as PlanId, new Date().toISOString(), {
      merchant: accountForPick(plan.id, merchantOf(b.merchant)),
      ...(current?.customerId ? { customerId: current.customerId } : {}),
      dueId,
    });
    await this.leads.enqueueSettleWatch(id, pick);
    return {
      ok: true as const,
      userId: id,
      dueId,
      planId: plan.id,
      merchant: pick.merchant,
    };
  }

  /**
   * GET /admin/users?q= — search users. A blank q lists users (capped); otherwise
   * a name, business or email by text, or a (partial) phone by its digits.
   * REQ-507 (demo m25): "abc!!" listed everyone — a q that matches nobody is [].
   */
  @Get("users")
  async search(
    @Context() ctx: ExecutionContext,
    @Query("q") q?: string,
  ): Promise<AdminUserView[]> {
    await requireSuperAdmin(ctx, this.sessions, this.users);
    const query = (q ?? "").trim();
    if (query === "") {
      const all = await this.users.searchByPhone("");
      return await Promise.all(all.map(async (u) => {
        const identity = await this.identities.get(u.id);
        return projectAdminUser(u, identity?.businessName);
      }));
    }
    const out: AdminUserView[] = [];
    for (const u of await this.users.searchByPhone("", 100_000)) {
      const business = (await this.identities.get(u.id))?.businessName;
      if (adminSearchMatches(u, business, query)) {
        out.push(projectAdminUser(u, business));
        if (out.length >= ADMIN_SEARCH_LIMIT) break;
      }
    }
    return out;
  }

  /** POST /admin/users/:id/grant — grant super-admin to a user. */
  @Post("users/:id/grant")
  async grant(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
  ): Promise<AdminUserView> {
    await requireSuperAdmin(ctx, this.sessions, this.users);
    const user = await this.users.setSuperAdmin(id, true);
    const identity = await this.identities.get(user.id);
    return projectAdminUser(user, identity?.businessName);
  }

  /** REQ-177: PUT /admin/users/:id/features { key, on } — switch one feature for one account. */
  @Put("users/:id/features")
  async setFeature(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<AdminUserView> {
    await requireSuperAdmin(ctx, this.sessions, this.users);
    const b = (body ?? {}) as { key?: unknown; on?: unknown };
    if (!isFeatureKey(b.key) || typeof b.on !== "boolean") {
      throw Object.assign(
        new Error("key must be a registered feature and on a boolean"),
        { status: 400 },
      );
    }
    const user = await this.users.setFeature(id, b.key, b.on);
    const identity = await this.identities.get(user.id);
    return projectAdminUser(user, identity?.businessName);
  }

  /** POST /admin/users/:id/revoke — revoke super-admin from a user. */
  @Post("users/:id/revoke")
  async revoke(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
  ): Promise<AdminUserView> {
    await requireSuperAdmin(ctx, this.sessions, this.users);
    const user = await this.users.setSuperAdmin(id, false);
    const identity = await this.identities.get(user.id);
    return projectAdminUser(user, identity?.businessName);
  }

  /**
   * POST /admin/impersonate/:id — start acting as user `:id`. Swaps the
   * browser's pm_session cookie to a fresh impersonation session and returns
   * the new session id (for header-based SDK/API clients).
   */
  @Post("impersonate/:id")
  async startImpersonating(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
  ) {
    const realUser = await requireSuperAdmin(ctx, this.sessions, this.users);
    const realSessionId = readSessionId(ctx);
    if (!realSessionId) throw new UnauthorizedError();
    const { session, user } = await this.impersonate.start({
      realUser,
      realSessionId,
      targetUserId: id,
    });
    ctx.header("Set-Cookie", buildSessionCookie(session.id));
    return {
      ok: true,
      sessionId: session.id,
      user: projectAdminUser(user),
    };
  }

  /**
   * POST /admin/stop-impersonating — return to the real super-admin. Scoped to
   * the caller's OWN impersonation session (no admin check needed — while
   * impersonating, the effective user usually isn't a super admin).
   */
  @Post("stop-impersonating")
  async stopImpersonating(@Context() ctx: ExecutionContext) {
    const sessionId = readSessionId(ctx);
    if (!sessionId) throw new UnauthorizedError();
    const current = await this.sessions.get(sessionId);
    if (!current) throw new UnauthorizedError();
    const { session, user } = await this.impersonate.stop(current);
    ctx.header("Set-Cookie", buildSessionCookie(session.id));
    return {
      ok: true,
      sessionId: session.id,
      user: projectAdminUser(user),
    };
  }

  /**
   * GET /admin/whoami — session context for the current browser. Any valid
   * session can read its OWN context (effective user, whether it's a super
   * admin, and whether it's an impersonation session + by whom). Powers the
   * persistent "you are impersonating" banner.
   */
  @Get("whoami")
  async whoami(@Context() ctx: ExecutionContext) {
    const sessionId = readSessionId(ctx);
    if (!sessionId) return { authenticated: false } as const;
    const session = await this.sessions.get(sessionId);
    if (!session) return { authenticated: false } as const;
    let user;
    try {
      user = await this.users.get(session.userId);
    } catch {
      return { authenticated: false } as const;
    }
    let impersonator: AdminUserView | null = null;
    if (session.impersonatorId) {
      const real = await this.users.get(session.impersonatorId).catch(() =>
        null
      );
      if (real) impersonator = projectAdminUser(real);
    }
    return {
      authenticated: true as const,
      user: projectAdminUser(user),
      superAdmin: user.superAdmin === true,
      impersonating: Boolean(session.impersonatorId),
      impersonator,
    };
  }

  /**
   * GET /admin/landing-offers — the single source of truth for the marketing
   * offer both landing pages render (from-price, the "unlimited"
   * tier, social-proof counters). Read by the super-admin "configure landing
   * offers" section (P-08). Any authenticated session may read it; the values
   * live in shared/quote-flow/landing-offers.ts so the pages and this endpoint
   * never drift.
   */
  @Get("landing-offers")
  async landingOffers(@Context() ctx: ExecutionContext) {
    await requireUser(ctx, this.sessions, this.users);
    return {
      priceFromCents: LANDING_OFFER.priceFromCents,
      unlimitedTier: LANDING_OFFER.unlimitedTier,
      socialProof: {
        contractors: LANDING_OFFER.socialProof.contractors,
        docsSent: LANDING_OFFER.socialProof.docsSent,
      },
    };
  }

  /**
   * POST /admin/bootstrap — cold-start the first super admin. Gated by
   * BootstrapSuperAdmin (dev-open / prod-token). Body: { phoneNumber, token? }.
   * See bootstrap-super-admin for the gate rationale.
   */
  @Post("bootstrap")
  async bootstrapSuperAdmin(@Body() body: unknown) {
    const input = (body ?? {}) as { phoneNumber?: string; token?: string };
    if (!input.phoneNumber) throw new Error("phoneNumber required");
    const user = await this.bootstrap.byPhone(input.phoneNumber, input.token);
    return { ok: true, user: projectAdminUser(user) };
  }
}
