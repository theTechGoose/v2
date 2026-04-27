import { Body, Context, Controller, Get, Put } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { BusinessInsuranceStore } from "@profile/domain/data/business-insurance-store/mod.ts";
import { parseUpdateBusinessInsurance } from "@profile/dto/business-insurance.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/entrypoints/auth-helpers.ts";

@Controller("profile/insurance")
export class BusinessInsuranceController {
  constructor(
    private store: BusinessInsuranceStore,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  @Get()
  async get(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return ctx.json(await this.store.get(user.id));
  }

  @Put()
  async upsert(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.store.upsert(user.id, parseUpdateBusinessInsurance(body));
  }
}
