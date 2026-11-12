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
import { overpaymentCheck } from "#documents/overpayment.ts"; // REQ-551
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import { paymentRecordedEvent } from "@paperwork/domain/business/owner-activity/mod.ts"; // REQ-566

/** REQ-551: the over-the-balance acknowledgement is a request flag, never a
 *  stored field (same shape as REQ-233's over-billing `override`). */
function takeOverride(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const b = body as { override?: unknown };
  const override = b.override === true;
  delete b.override;
  return override;
}

/** REQ-551 (demo-loop cycle 4, B2): a payment above what the invoice still
 *  owes is a 409 `overpayment` unless the request says `override: true`
 *  (REQ-202 then flags it on the invoice); above 10x the invoice it is a
 *  422 `overpayment_limit` either way. `excludePaymentId` leaves out the
 *  payment being edited. Null when the payment may be recorded. A free
 *  function: Danet routes every controller method, so no undecorated ones. */
async function refuseOverpayment(
  payments: PaymentStore,
  invoice: { id: string; amount?: number },
  userId: string,
  paymentCents: number,
  override: boolean,
  excludePaymentId?: string,
): Promise<{ status: 409 | 422; body: Record<string, unknown> } | null> {
  const paidCents = (await payments.listByInvoice(invoice.id, userId))
    .filter((p) => p.id !== excludePaymentId)
    .reduce((sum, p) => sum + (p.amount ?? 0), 0);
  const check = overpaymentCheck({
    paymentCents,
    amountCents: invoice.amount,
    paidCents,
  });
  if (check.kind === "refuse") {
    return {
      status: 422,
      body: {
        ok: false,
        error: "overpayment_limit",
        reason: "overpayment_limit",
        amountCents: invoice.amount ?? 0,
        balanceCents: check.balanceCents,
        limitCents: check.limitCents,
        message: "Payment is more than 10 times the invoice.",
      },
    };
  }
  if (check.kind === "over" && !override) {
    return {
      status: 409,
      body: {
        ok: false,
        error: "overpayment",
        reason: "overpayment",
        balanceCents: check.balanceCents,
        overCents: check.overCents,
        message:
          "Payment is more than the balance owed; resend with override: true to record it.",
      },
    };
  }
  return null;
}


@Controller("payments")
export class PaymentController {
  constructor(
    private store: PaymentStore,
    private invoices: InvoiceStore,
    private balances: ComputeInvoiceBalance,
    private users: UserStore,
    private sessions: SessionStore,
    private customers: CustomerStore,
    private bus: EventBus,
  ) {}

  @Post()
  async create(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const override = takeOverride(body); // REQ-551
    const dto = parseCreatePayment(body);
    const invoice = await this.invoices.getOwned(dto.invoiceId, user.id);
    const refused = await refuseOverpayment(this.store, invoice, user.id, dto.amount, override);
    if (refused) return ctx.json(refused.body, refused.status);
    const created = await this.store.create(user.id, dto);
    await this.balances.run(dto.invoiceId, user.id);
    // REQ-566 (cycle 4, m11): money the owner recorded is activity — the
    // dashboard's "What we handled today" feed says so.
    const customerName = invoice.customerId
      ? await this.customers.getOwned(invoice.customerId, user.id)
        .then((c) => c.name || undefined, () => undefined)
      : undefined;
    await this.bus.emit(paymentRecordedEvent(user.id, created, customerName));
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
    const override = takeOverride(body); // REQ-551
    const patch = parseUpdatePayment(body);
    if (typeof patch.amount === "number") {
      const existing = await this.store.getOwned(id, user.id);
      const invoice = await this.invoices.getOwned(existing.invoiceId, user.id);
      const refused = await refuseOverpayment(this.store, invoice, user.id, patch.amount, override, id);
      if (refused) return ctx.json(refused.body, refused.status);
    }
    const updated = await this.store.update(id, user.id, patch);
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
