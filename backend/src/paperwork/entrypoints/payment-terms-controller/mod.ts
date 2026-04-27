import { Body, Context, Controller, Delete, Get, Param, Post, Put, Query } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { PaymentTermsStore } from "@paperwork/domain/data/payment-terms-store/mod.ts";
import {
  parseCreatePaymentTerms,
  parseUpdatePaymentTerms,
} from "@paperwork/dto/payment-terms.ts";
import {
  applyTo,
  isBalanced,
  totalPercent,
} from "@paperwork/domain/business/installment-schedule/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/entrypoints/auth-helpers.ts";

@Controller("payment-terms")
export class PaymentTermsController {
  constructor(
    private store: PaymentTermsStore,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  @Post()
  async create(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.store.create(user.id, parseCreatePaymentTerms(body));
  }

  @Get()
  async list(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.store.listByUser(user.id);
  }

  @Get(":id")
  async get(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.store.getOwned(id, user.id);
  }

  @Get(":id/check")
  async check(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const terms = await this.store.getOwned(id, user.id);
    return {
      id: terms.id,
      totalPercent: totalPercent(terms.installments),
      isBalanced: isBalanced(terms.installments),
    };
  }

  @Get(":id/resolve")
  async resolve(@Context() ctx: ExecutionContext, @Param("id") id: string, @Query("total") total?: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const terms = await this.store.getOwned(id, user.id);
    const amount = Number(total);
    if (!Number.isFinite(amount)) {
      throw new Error(`?total query param must be a number, got: ${total}`);
    }
    return {
      id: terms.id,
      total: amount,
      installments: applyTo(terms.installments, amount),
    };
  }

  @Put(":id")
  async update(@Context() ctx: ExecutionContext, @Param("id") id: string, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.store.update(id, user.id, parseUpdatePaymentTerms(body));
  }

  @Delete(":id")
  async delete(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    await this.store.delete(id, user.id);
    return { ok: true };
  }
}
