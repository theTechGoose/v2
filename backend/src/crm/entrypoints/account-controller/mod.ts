import { Body, Context, Controller, Delete, Get, Param, Post, Put, Query } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { AccountStore } from "@crm/domain/data/account-store/mod.ts";
import { ComputeAccountBalance } from "@crm/domain/coordinators/compute-account-balance/mod.ts";
import { parseCreateAccount, parseUpdateAccount } from "@crm/dto/account.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/entrypoints/auth-helpers.ts";

@Controller("accounts")
export class AccountController {
  constructor(
    private store: AccountStore,
    private balance: ComputeAccountBalance,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  @Post()
  async create(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.store.create(user.id, parseCreateAccount(body));
  }

  @Get()
  async list(@Context() ctx: ExecutionContext, @Query("customerId") customerId?: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return customerId
      ? await this.store.listByCustomer(user.id, customerId)
      : await this.store.listByUser(user.id);
  }

  @Get(":id")
  async get(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.store.getOwned(id, user.id);
  }

  @Get(":id/balance")
  async standing(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    // Defense-in-depth: confirm the caller owns the account before fanning out.
    await this.store.getOwned(id, user.id);
    return await this.balance.run(id);
  }

  @Put(":id")
  async update(@Context() ctx: ExecutionContext, @Param("id") id: string, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.store.update(id, user.id, parseUpdateAccount(body));
  }

  @Delete(":id")
  async delete(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    await this.store.delete(id, user.id);
    return { ok: true };
  }
}
