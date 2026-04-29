import { Body, Context, Controller, Delete, Get, Param, Post, Put, Query } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { parseCreateInvoice, parseUpdateInvoice, type Invoice } from "@paperwork/dto/invoice.ts";
import { deriveUrgency } from "@paperwork/domain/business/invoice-urgency/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";

function project(invoice: Invoice, now: Date): Invoice {
  return { ...invoice, urgency: deriveUrgency(invoice, now) };
}

@Controller("invoices")
export class InvoiceController {
  constructor(
    private store: InvoiceStore,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  @Post()
  async create(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return project(await this.store.create(user.id, parseCreateInvoice(body)), new Date());
  }

  @Get()
  async list(@Context() ctx: ExecutionContext, @Query("status") status?: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const list = status
      ? await this.store.listByUserAndStatus(user.id, status)
      : await this.store.listByUser(user.id);
    const now = new Date();
    return list.map((i) => project(i, now));
  }

  @Get(":id")
  async get(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return project(await this.store.getOwned(id, user.id), new Date());
  }

  @Put(":id")
  async update(@Context() ctx: ExecutionContext, @Param("id") id: string, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return project(await this.store.update(id, user.id, parseUpdateInvoice(body)), new Date());
  }

  @Delete(":id")
  async delete(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    await this.store.delete(id, user.id);
    return { ok: true };
  }
}
