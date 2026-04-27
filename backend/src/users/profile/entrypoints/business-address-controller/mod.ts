import { Body, Context, Controller, Get, Put } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { BusinessAddressStore } from "@profile/domain/data/business-address-store/mod.ts";
import { parseUpdateBusinessAddress } from "@profile/dto/business-address.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/entrypoints/auth-helpers.ts";

@Controller("profile/address")
export class BusinessAddressController {
  constructor(
    private store: BusinessAddressStore,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  @Get()
  async get(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return ctx.json(await this.store.get(user.id));      // null when missing
  }

  @Put()
  async upsert(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.store.upsert(user.id, parseUpdateBusinessAddress(body));
  }
}
