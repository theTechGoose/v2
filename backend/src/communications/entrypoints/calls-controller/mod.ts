/** REQ-900/904 — GET /communications/calls, GET /communications/calls/:id — the signed-in user's line */
import { Context, Controller, Get, Param } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";
import { Calls } from "@communications/domain/coordinators/calls/mod.ts";
import { LineContext } from "@communications/domain/coordinators/line-context/mod.ts";

@Controller("communications/calls")
export class CallsController {
  constructor(private calls: Calls, private lineContext: LineContext, private users: UserStore, private sessions: SessionStore) {}

  @Get()
  async list(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const limit = Number(new URL(ctx.req.raw.url).searchParams.get("limit") ?? 100) || 100;
    return await this.calls.list(Math.min(limit, 500), await this.lineContext.forUser(user.id));
  }

  @Get(":id")
  async get(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    await requireUser(ctx, this.sessions, this.users);
    return await this.calls.get(id);
  }
}
