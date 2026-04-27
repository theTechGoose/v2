import { Body, Context, Controller, Get, Put } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { parseUpdateBusinessIdentity } from "@profile/dto/business-identity.ts";
import { requireUser } from "@users/entrypoints/auth-helpers.ts";

@Controller("profile/identity")
export class BusinessIdentityController {
  constructor(
    private store: BusinessIdentityStore,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  @Get()
  async get(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const value = await this.store.get(user.id);       // null when not yet created
    return ctx.json(value);                            // ctx.json(null) → body "null", not empty
  }

  @Put()
  async upsert(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const patch = parseUpdateBusinessIdentity(body);
    return await this.store.upsert(user.id, patch);
  }
}
