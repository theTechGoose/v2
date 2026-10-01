import { Body, Context, Controller, Get, Put } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { parseUpdateBusinessIdentity } from "@profile/dto/business-identity.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";
import { CrmCustomerSync } from "@users/domain/coordinators/crm-customer-sync/mod.ts";

@Controller("profile/identity")
export class BusinessIdentityController {
  constructor(
    private store: BusinessIdentityStore,
    private users: UserStore,
    private sessions: SessionStore,
    private crm: CrmCustomerSync,
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
    const saved = await this.store.upsert(user.id, patch);
    await this.crm.sync(user.id); // REQ-058 — the business name is the CRM customer's name
    return saved;
  }
}
