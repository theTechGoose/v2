import { Body, Context, Controller, Delete, Get, Param, Post, Put, Query } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { parseCreateQuote, parseUpdateQuote } from "@paperwork/dto/quote.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/entrypoints/auth-helpers.ts";

@Controller("quotes")
export class QuoteController {
  constructor(
    private store: QuoteStore,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  @Post()
  async create(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.store.create(user.id, parseCreateQuote(body));
  }

  /**
   * GET /quotes[?status=]
   *   - status omitted: all of the user's quotes
   *   - status=draft|sent|accepted: filtered (used by the dashboard's "Quotes awaiting" panel)
   */
  @Get()
  async list(@Context() ctx: ExecutionContext, @Query("status") status?: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return status
      ? await this.store.listByUserAndStatus(user.id, status)
      : await this.store.listByUser(user.id);
  }

  @Get(":id")
  async get(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.store.getOwned(id, user.id);
  }

  @Put(":id")
  async update(@Context() ctx: ExecutionContext, @Param("id") id: string, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.store.update(id, user.id, parseUpdateQuote(body));
  }

  @Delete(":id")
  async delete(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    await this.store.delete(id, user.id);
    return { ok: true };
  }
}
