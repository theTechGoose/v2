import { Body, Context, Controller, Delete, Get, Param, Post, Put, Query } from "#danet/core";
import { matchesQuery, pageOf, sortByName } from "@analytics/domain/business/clients-page/mod.ts"; // REQ-135 — the one set of paging rules
import type { ExecutionContext } from "#danet/core";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import {
  parseCreateCustomer,
  parseUpdateCustomer,
} from "@crm/dto/customer.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";

@Controller("customers")
export class CustomerController {
  constructor(
    private store: CustomerStore,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  @Post()
  async create(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.store.create(user.id, parseCreateCustomer(body));
  }

  /** the array, as always; REQ-135 — `?page=`, `?pageSize=` or `?q=` asks for one page: `{ items, page, pageSize, total, totalPages }` */
  @Get()
  async list(
    @Context() ctx: ExecutionContext,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("q") q?: string,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const all = await this.store.listByUser(user.id);
    if (page === undefined && pageSize === undefined && q === undefined) return all;
    return pageOf(sortByName(all.filter((c) => matchesQuery(c, q))), Number(page), Number(pageSize));
  }

  @Get(":id")
  async get(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.store.getOwned(id, user.id);
  }

  @Put(":id")
  async update(@Context() ctx: ExecutionContext, @Param("id") id: string, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.store.update(id, user.id, parseUpdateCustomer(body));
  }

  @Delete(":id")
  async delete(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    await this.store.delete(id, user.id);
    return { ok: true };
  }
}
