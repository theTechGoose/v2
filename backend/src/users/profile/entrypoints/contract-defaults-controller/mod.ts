import { Body, Context, Controller, Get, Put } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { ContractDefaultsStore } from "@profile/domain/data/contract-defaults-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { parseUpdateContractDefaults } from "@profile/dto/contract-defaults.ts";
import { requireUser } from "@users/entrypoints/auth-helpers.ts";

@Controller("profile/contract-defaults")
export class ContractDefaultsController {
  constructor(
    private store: ContractDefaultsStore,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  @Get()
  async get(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const value = await this.store.get(user.id);
    return ctx.json(value);                            // null is serialized as "null", not empty body
  }

  @Put()
  async upsert(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const patch = parseUpdateContractDefaults(body);
    return await this.store.upsert(user.id, patch);
  }
}
