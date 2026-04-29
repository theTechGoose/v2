import { Body, Context, Controller, Delete, Get, Param, Post, Put, Query } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { EntryStore } from "@crm/domain/data/entry-store/mod.ts";
import { parseCreateEntry, parseUpdateEntry } from "@crm/dto/entry.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";

@Controller("entries")
export class EntryController {
  constructor(
    private store: EntryStore,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  @Post()
  async create(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.store.create(user.id, parseCreateEntry(body));
  }

  @Get()
  async list(
    @Context() ctx: ExecutionContext,
    @Query("accountId") accountId?: string,
    @Query("transactionId") transactionId?: string,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    if (accountId)     return await this.store.listByAccount(user.id, accountId);
    if (transactionId) return await this.store.listByTransaction(user.id, transactionId);
    return await this.store.listByUser(user.id);
  }

  @Get(":id")
  async get(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.store.getOwned(id, user.id);
  }

  @Put(":id")
  async update(@Context() ctx: ExecutionContext, @Param("id") id: string, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.store.update(id, user.id, parseUpdateEntry(body));
  }

  @Delete(":id")
  async delete(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    await this.store.delete(id, user.id);
    return { ok: true };
  }
}
