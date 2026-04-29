import { Body, Context, Controller, Delete, Get, Param, Post, Put, Query } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { PaymentStore } from "@paperwork/domain/data/payment-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { parseCreatePayment, parseUpdatePayment } from "@paperwork/dto/payment.ts";
import type { PaymentMethod } from "@paperwork/dto/payment.ts";
import { ComputeInvoiceBalance } from "@paperwork/domain/coordinators/compute-invoice-balance/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";

@Controller("payments")
export class PaymentController {
  constructor(
    private store: PaymentStore,
    private invoices: InvoiceStore,
    private balances: ComputeInvoiceBalance,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  @Post()
  async create(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const dto = parseCreatePayment(body);
    await this.invoices.getOwned(dto.invoiceId, user.id);
    const created = await this.store.create(user.id, dto);
    await this.balances.run(dto.invoiceId, user.id);
    return created;
  }

  @Get()
  async list(
    @Context() ctx: ExecutionContext,
    @Query("method") method?: string,
    @Query("invoiceId") invoiceId?: string,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    if (invoiceId) return await this.store.listByInvoice(invoiceId, user.id);
    if (method) return await this.store.listByUserAndMethod(user.id, method as PaymentMethod);
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
    const updated = await this.store.update(id, user.id, parseUpdatePayment(body));
    await this.balances.run(updated.invoiceId, user.id);
    return updated;
  }

  @Delete(":id")
  async delete(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const existing = await this.store.getOwned(id, user.id);
    await this.store.delete(id, user.id);
    await this.balances.run(existing.invoiceId, user.id);
    return { ok: true };
  }
}
