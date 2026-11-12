import {
  Body,
  Context,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { requireSuperAdmin } from "@users/domain/coordinators/require-super-admin/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import type { User } from "@users/dto/user.ts";
import { DemoSessionStore } from "@demo-mode/domain/data/demo-session-store/mod.ts";
import { DemoHub } from "@demo-mode/domain/coordinators/demo-hub/mod.ts";
import {
  DemoAccess,
  DemoForbiddenError,
  DemoNotFoundError,
} from "@demo-mode/domain/coordinators/demo-access/mod.ts";
import { isSafePath, nextColor } from "#demo-mode/protocol.ts";
import { presentersOf } from "@demo-mode/domain/business/demo-role/mod.ts";
import {
  presenterNameOf,
  targetNameOf,
} from "@demo-mode/domain/business/display-name/mod.ts";

/** REQ-227 — a super admin cannot open a demo on their own account */
class DemoOnSelfError extends Error {
  readonly status = 400;
  constructor() {
    super("a demo cannot be opened on your own account");
  }
}

/** REQ-214 / REQ-232 — a presenter off a demo: it goes on for the others (who hear them go, and
 *  their sockets close everywhere), and ends for everyone when nobody is left on it. A module
 *  function: Danet routes every controller method. */
async function leaveDemo(
  demos: DemoSessionStore,
  hub: DemoHub,
  id: string,
  userId: string,
): Promise<void> {
  const rest = await demos.leave(id, userId);
  if (rest && !rest.endedAt && presentersOf(rest).length === 0) {
    await demos.end(id);
    // REQ-235 — the customer hears it was this presenter (the last one to go)
    await hub.end(id, "presenter", undefined, userId);
  } else if (rest && !rest.endedAt) {
    await hub.dropPresenter(id, userId);
  }
}

/**
 * REQ-153 — demo mode over HTTP (the socket is DemoModeSocketController, at `api/demo-mode`).
 *
 *   POST /demo-mode/sessions { userId }   super admin → 201 { id, targetUserId, targetPath, createdAt }; the demo this
 *                                         admin already presents to that user → 200, the same one; a demo someone ELSE
 *                                         is running for that user → 200, JOINED as another presenter with the next free
 *                                         colour (REQ-214); a demo for another user takes this admin off their current
 *                                         one (it ends when nobody is left on it). `targetPath` (REQ-179): where the
 *                                         customer is, so the staff browser moves on this one answer
 *   GET  /demo-mode/active?path=/x        any session → { role, session: { id, presenterName, targetName, targetUserId,
 *                                         presenters: [{ userId, name, color }] } | null, targetPath, pid }: `path` is where
 *                                         the caller's own app is (recorded WHERE_TTL_MS, never from an impersonation
 *                                         session); `targetPath` tells the presenter where the customer is; `pid` is which
 *                                         presenter the caller is (REQ-214)
 *   POST /demo-mode/sessions/:id/end      a participant, `{ reason?: "declined" }` → { ok: true }; 403 anyone else; 404 unknown
 *   POST /demo-mode/sessions/:id/leave    a presenter (REQ-232 — "Return to your account" during the demo) → { ok: true }: they
 *                                         are off it; it goes on for the other presenters and ends when nobody is left; 403 the
 *                                         customer (who ends a demo, never leaves it) and anyone not presenting it; 404 unknown
 */
@Controller("demo-mode")
export class DemoModeController {
  constructor(
    private users: UserStore,
    private sessions: SessionStore,
    private demos: DemoSessionStore,
    private hub: DemoHub,
    private access: DemoAccess,
  ) {}

  @Post("sessions")
  async start(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const admin = await requireSuperAdmin(ctx, this.sessions, this.users);
    const userId = (body as { userId?: unknown } | null)?.userId;
    if (typeof userId !== "string" || !userId) throw new DemoNotFoundError();
    // REQ-227 (demo-lifecycle-p2) — a demo on yourself would make you the customer AND the presenter
    if (userId === admin.id) throw new DemoOnSelfError();
    let target: User;
    try {
      target = await this.users.get(userId);
    } catch {
      throw new DemoNotFoundError();
    }
    // AMENDMENT — same screen at once: five clicks are one invitation; REQ-214 — a new customer
    // takes this presenter off the old demo (it goes on for the others; nobody left, it ends)
    const prev = await this.demos.presentingBy(admin.id);
    const targetPath = await this.demos.whereIs(target.id);
    if (prev && prev.targetUserId === target.id) {
      return ctx.json({
        id: prev.id,
        targetUserId: prev.targetUserId,
        targetPath,
        createdAt: prev.createdAt,
      }, 200);
    }
    if (prev) await leaveDemo(this.demos, this.hub, prev.id, admin.id);
    // REQ-214 — the customer is already being guided: join that demo as another presenter
    const live = await this.demos.activeFor(target.id);
    if (live) {
      const joined = await this.demos.join(live.id, {
        userId: admin.id,
        name: presenterNameOf(admin),
        color: nextColor(presentersOf(live).map((p) => p.color)),
      });
      if (joined) {
        return ctx.json({
          id: joined.id,
          targetUserId: joined.targetUserId,
          targetPath,
          createdAt: joined.createdAt,
        }, 200);
      }
    }
    const demo = await this.demos.create(target.id, {
      userId: admin.id,
      name: presenterNameOf(admin),
      color: nextColor([]),
    });
    return ctx.json({
      id: demo.id,
      targetUserId: demo.targetUserId,
      targetPath,
      createdAt: demo.createdAt,
    }, 201);
  }

  @Get("active")
  async active(
    @Context() ctx: ExecutionContext,
    @Query("path") path?: string,
  ) {
    const caller = await this.access.caller(ctx);
    // the caller's own app says where it is — an impersonation session is the presenter's browser, not the customer's
    if (isSafePath(path) && !caller.session.impersonatorId) {
      await this.demos.here(caller.user.id, path);
    }
    const current = await this.access.current(caller);
    if (!current) {
      return { role: null, session: null, targetPath: null, pid: null };
    }
    // REQ-355 — a presenter stored under the sign-in placeholder shows as the brand
    const presenters = presentersOf(current.demo).map((p) => ({
      ...p,
      name: p.name ? presenterNameOf(p) : "",
    }));
    const [opener, target, targetPath] = await Promise.all([
      presenters[0]?.name
        ? Promise.resolve(null)
        : this.users.get(current.demo.presenterUserId).catch(() => null),
      this.users.get(current.demo.targetUserId).catch(() => null),
      current.role === "presenter"
        ? this.demos.whereIs(current.demo.targetUserId)
        : Promise.resolve(null),
    ]);
    return {
      role: current.role,
      session: {
        id: current.demo.id,
        presenterName: presenters[0]?.name ||
          (opener ? presenterNameOf(opener) : ""),
        targetName: target ? targetNameOf(target) : "",
        targetUserId: current.demo.targetUserId,
        // REQ-214 — everyone presenting, each with their colour
        presenters,
      },
      targetPath,
      // REQ-214 — which presenter the caller is (null for the viewer)
      pid: current.pid,
    };
  }

  @Post("sessions/:id/leave")
  async leave(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const caller = await this.access.caller(ctx);
    const { demo, role, pid } = await this.access.roleIn(caller, id);
    if (role !== "presenter" || !pid) throw new DemoForbiddenError();
    if (!demo.endedAt) await leaveDemo(this.demos, this.hub, id, pid);
    return { ok: true };
  }

  @Post("sessions/:id/end")
  async end(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const caller = await this.access.caller(ctx);
    // the body is optional (a plain End sends none) — read it by hand, @Body() 500s on an empty one
    const body: unknown = await ctx.req.json().catch(() => null);
    const { demo, role, pid } = await this.access.roleIn(caller, id, {
      evenEnded: true,
    });
    // AMENDMENT — "Not now": the viewer's decline rides the ended message so the presenter's pill can say so
    const reason = (body as { reason?: unknown } | null)?.reason === "declined"
      ? "declined" as const
      : undefined;
    if (!demo.endedAt) {
      await this.demos.end(id);
      // REQ-235 — and who ended it
      await this.hub.end(id, role, reason, pid ?? undefined);
    }
    return { ok: true };
  }
}
