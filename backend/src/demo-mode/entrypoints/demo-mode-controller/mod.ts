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
  DemoNotFoundError,
} from "@demo-mode/domain/coordinators/demo-access/mod.ts";
import { isSafePath } from "#demo-mode/protocol.ts";

const nameOf = (u: User) => u.name?.trim() || u.phoneNumber;

/**
 * REQ-153 — demo mode over HTTP (the socket is DemoModeSocketController, at `api/demo-mode`).
 *
 *   POST /demo-mode/sessions { userId }   super admin → 201 { id, targetUserId, targetPath, createdAt }; the demo this
 *                                         admin already presents to that user → 200, the same one; a demo for another
 *                                         user ends it. `targetPath` (REQ-179): where the customer is, so the staff
 *                                         browser moves on this one answer
 *   GET  /demo-mode/active?path=/x        any session → { role, session: { id, presenterName, targetName, targetUserId } | null,
 *                                         targetPath }: `path` is where the caller's own app is (recorded WHERE_TTL_MS, never
 *                                         from an impersonation session); `targetPath` tells the presenter where the customer is
 *   POST /demo-mode/sessions/:id/end      a participant, `{ reason?: "declined" }` → { ok: true }; 403 anyone else; 404 unknown
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
    let target: User;
    try {
      target = await this.users.get(userId);
    } catch {
      throw new DemoNotFoundError();
    }
    // AMENDMENT — same screen at once: five clicks are one invitation; a new customer ends the old demo
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
    if (prev) {
      await this.demos.end(prev.id);
      await this.hub.end(prev.id, "presenter");
    }
    const demo = await this.demos.create(target.id, admin.id);
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
    if (!current) return { role: null, session: null, targetPath: null };
    const [presenter, target, targetPath] = await Promise.all([
      this.users.get(current.demo.presenterUserId).catch(() => null),
      this.users.get(current.demo.targetUserId).catch(() => null),
      current.role === "presenter"
        ? this.demos.whereIs(current.demo.targetUserId)
        : Promise.resolve(null),
    ]);
    return {
      role: current.role,
      session: {
        id: current.demo.id,
        presenterName: presenter ? nameOf(presenter) : "",
        targetName: target ? nameOf(target) : "",
        targetUserId: current.demo.targetUserId,
      },
      targetPath,
    };
  }

  @Post("sessions/:id/end")
  async end(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const caller = await this.access.caller(ctx);
    // the body is optional (a plain End sends none) — read it by hand, @Body() 500s on an empty one
    const body: unknown = await ctx.req.json().catch(() => null);
    const { demo, role } = await this.access.roleIn(caller, id, {
      evenEnded: true,
    });
    // AMENDMENT — "Not now": the viewer's decline rides the ended message so the presenter's pill can say so
    const reason = (body as { reason?: unknown } | null)?.reason === "declined"
      ? "declined" as const
      : undefined;
    if (!demo.endedAt) {
      await this.demos.end(id);
      await this.hub.end(id, role, reason);
    }
    return { ok: true };
  }
}
