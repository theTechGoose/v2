import { Body, Context, Controller, Delete, Get, Param, Post, Put, Query } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { ContractStore } from "@paperwork/domain/data/contract-store/mod.ts";
import { parseCreateContract, parseUpdateContract, type Contract } from "@paperwork/dto/contract.ts";
import { deriveMood } from "@paperwork/domain/business/contract-mood/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";

function project(contract: Contract, now: Date): Contract {
  return { ...contract, mood: deriveMood(contract, now) };
}

@Controller("contracts")
export class ContractController {
  constructor(
    private store: ContractStore,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  @Post()
  async create(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return project(await this.store.create(user.id, parseCreateContract(body)), new Date());
  }

  @Get()
  async list(@Context() ctx: ExecutionContext, @Query("status") status?: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const list = status
      ? await this.store.listByUserAndStatus(user.id, status)
      : await this.store.listByUser(user.id);
    const now = new Date();
    return list.map((c) => project(c, now));
  }

  @Get(":id")
  async get(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return project(await this.store.getOwned(id, user.id), new Date());
  }

  @Put(":id")
  async update(@Context() ctx: ExecutionContext, @Param("id") id: string, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return project(await this.store.update(id, user.id, parseUpdateContract(body)), new Date());
  }

  @Delete(":id")
  async delete(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    await this.store.delete(id, user.id);
    return { ok: true };
  }
}
