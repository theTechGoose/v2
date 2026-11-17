/**
 * REQ-920b — GET /communications/house/services (the main account's verified campaigns' services)
 * and POST /communications/house/adopt { serviceSid } (move the super admin's number under the
 * platform's registration). Super admins only: only the platform's own business may text under its brand.
 */
import { Body, Context, Controller, Get, Post } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireSuperAdmin } from "@users/domain/coordinators/require-super-admin/mod.ts";
import { HouseLine } from "@communications/domain/coordinators/house-line/mod.ts";

export class BadServiceSidError extends Error {
  readonly status: number = 400;
  constructor() {
    super("serviceSid must be a messaging service SID (MG…)");
    this.name = "BadServiceSidError";
  }
}

@Controller("communications/house")
export class HouseLineController {
  constructor(
    private house: HouseLine,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  @Get("services")
  async services(@Context() ctx: ExecutionContext) {
    await requireSuperAdmin(ctx, this.sessions, this.users);
    return { services: await this.house.services() };
  }

  @Post("adopt")
  async adopt(
    @Context() ctx: ExecutionContext,
    @Body() body: { serviceSid?: unknown },
  ) {
    const user = await requireSuperAdmin(ctx, this.sessions, this.users);
    const serviceSid = typeof body?.serviceSid === "string"
      ? body.serviceSid.trim()
      : "";
    if (!serviceSid.startsWith("MG")) throw new BadServiceSidError();
    return { line: await this.house.adopt(user.id, serviceSid) };
  }
}
