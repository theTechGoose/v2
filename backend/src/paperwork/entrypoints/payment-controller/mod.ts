import { ForbiddenError, NotFoundError } from "@core/data/repository/mod.ts"; // REQ-926
import { ChargebackPayment } from "@paperwork/domain/coordinators/chargeback-payment/mod.ts"; // REQ-926
import { parseFeeCents } from "@paperwork/domain/business/chargeback/mod.ts"; // REQ-926
import {
  Body,
  Context,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { PaymentStore } from "@paperwork/domain/data/payment-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import {
  parseCreatePayment,
  parseUpdatePayment,
} from "@paperwork/dto/payment.ts";
import type { PaymentMethod } from "@paperwork/dto/payment.ts";
import { ComputeInvoiceBalance } from "@paperwork/domain/coordinators/compute-invoice-balance/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";
import { overpaymentCheck } from "#documents/overpayment.ts"; // REQ-551
import { receivedAtProblem } from "#documents/received-day.ts"; // REQ-943
import {
  exportDateOf,
  exportRangeSuffix,
  filterByDateRange,
  parseExportRange,
  paymentExportCsv,
} from "#documents/exports.ts"; // REQ-795
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

/** REQ-943 (LOOP-007 q1-8): a received date after today (a day of slack for
 *  time zones) is a 422 `future_date`, one that does not parse a 422
 *  `invalid_date` — before anything is stored, so the invoice never closes
 *  on a future day and the customer is never emailed "PAID" for it. Null
 *  when the date may be recorded. A free function (Danet routes methods). */
function refuseReceivedAt(
  receivedAt: unknown,
): { status: 422; body: Record<string, unknown> } | null {
  const problem = receivedAtProblem(receivedAt);
  if (!problem) return null;
  return {
    status: 422,
    body: {
      ok: false,
      error: problem,
      reason: problem,
      message: problem === "future_date"
        ? "A payment can't be received after today."
        : "receivedAt is not a date.",
    },
  };
}

/** REQ-926: the JSON body when one was sent, {} when none. */
async function optionalJsonBody(ctx: ExecutionContext): Promise<unknown> {
  const raw = await ctx.req.text().catch(() => "");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** REQ-926: another owner's / a missing payment → 404 (a module function:
 *  Danet routes every method of a controller class). */
async function ownedOr404<T>(
  ctx: ExecutionContext,
  run: () => Promise<T>,
): Promise<T | Response> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof NotFoundError || e instanceof ForbiddenError) {
      return ctx.json({ ok: false, reason: "not_found" }, 404);
    }
    throw e;
  }
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
    private chargeback: ChargebackPayment, // REQ-926
  ) {}

  @Post()
  async create(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const override = takeOverride(body); // REQ-551
    const dto = parseCreatePayment(body);
    const badDate = refuseReceivedAt(dto.receivedAt); // REQ-943
    if (badDate) return ctx.json(badDate.body, badDate.status);
    const invoice = await this.invoices.getOwned(dto.invoiceId, user.id);
    const refused = await refuseOverpayment(
      this.store,
      invoice,
      user.id,
      dto.amount,
      override,
    );
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
    if (method) {
      return await this.store.listByUserAndMethod(
        user.id,
        method as PaymentMethod,
      );
    }
    // REQ-926: the whole list carries charged-back payments, stamped (the
    // /payments page's Charged back track); the per-invoice read does not.
    return await this.store.listByUserAll(user.id);
  }

  /**
   * REQ-795 (Reports): every recorded payment as CSV — received day, invoice,
   * customer, method, amount, reference — optionally only those received in
   * `?from`…`?to` (inclusive ISO days). Declared before `:id`.
   */
  @Get("export.csv")
  async exportCsv(
    @Context() ctx: ExecutionContext,
    @Query("from") fromQ?: string,
    @Query("to") toQ?: string,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const range = parseExportRange(fromQ, toQ);
    if ("field" in range) {
      return ctx.json(
        { ok: false, reason: "invalid", field: range.field },
        400,
      );
    }
    const [payments, invoices, customers] = await Promise.all([
      this.store.listByUser(user.id),
      this.invoices.listByUser(user.id),
      this.customers.listByUser(user.id),
    ]);
    const invoiceById = new Map(invoices.map((i) => [i.id, i]));
    const customerById = new Map(customers.map((c) => [c.id, c]));
    const rows = filterByDateRange(
      payments,
      (p) => exportDateOf("payments", p),
      range.from,
      range.to,
    ).sort((a, b) => (a.receivedAt ?? "").localeCompare(b.receivedAt ?? ""));
    const csv = paymentExportCsv(rows, {
      invoiceOf: (p) => invoiceById.get(p.invoiceId),
      customerOf: (id) => customerById.get(id),
    });
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="payments${
          exportRangeSuffix(range)
        }.csv"`,
      },
    });
  }

  /**
   * REQ-926: POST /payments/:id/chargeback { feeCents?, reason? } — the
   * payment is kept and stamped, the same invoice reopens, a fee > 0 joins
   * it as its own line. 409 `already_reversed`; not the owner's → 404.
   */
  @Post(":id/chargeback")
  async chargebackPayment(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    // a bare POST is {} — never a 500 through @Body (REQ-627 AMENDMENT's rule)
    const body = await optionalJsonBody(ctx);
    const b = (body && typeof body === "object" ? body : {}) as {
      feeCents?: unknown;
      reason?: unknown;
    };
    const feeCents = parseFeeCents(b.feeCents);
    if (feeCents === null) {
      return ctx.json({ ok: false, reason: "invalid_fee" }, 400);
    }
    const reason = typeof b.reason === "string" && b.reason.trim()
      ? b.reason.trim().slice(0, 300)
      : undefined;
    const r = await ownedOr404(
      ctx,
      () => this.chargeback.charge(id, user.id, { feeCents, reason }),
    );
    if (r instanceof Response) return r;
    if (!r.ok) return ctx.json({ ok: false, reason: r.reason }, 409);
    return ctx.json(r.payment);
  }

  /** REQ-926: undo — the stamp and the fee line come off, the balance is
   *  recomputed. 409 `not_reversed`. */
  @Post(":id/chargeback/undo")
  async undoChargeback(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const r = await ownedOr404(ctx, () => this.chargeback.undo(id, user.id));
    if (r instanceof Response) return r;
    if (!r.ok) return ctx.json({ ok: false, reason: r.reason }, 409);
    return ctx.json(r.payment);
  }

  @Get(":id")
  async get(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.store.getOwned(id, user.id);
  }

  @Put(":id")
  async update(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const override = takeOverride(body); // REQ-551
    const patch = parseUpdatePayment(body);
    // REQ-926: the chargeback stamp has its own route; never from a PUT
    for (const k of ["reversedAt", "reversedReason", "reversedFeeCents"]) {
      delete (patch as Record<string, unknown>)[k];
    }
    if (patch.receivedAt !== undefined) {
      const badDate = refuseReceivedAt(patch.receivedAt); // REQ-943
      if (badDate) return ctx.json(badDate.body, badDate.status);
    }
    if (typeof patch.amount === "number") {
      const existing = await this.store.getOwned(id, user.id);
      const invoice = await this.invoices.getOwned(existing.invoiceId, user.id);
      const refused = await refuseOverpayment(
        this.store,
        invoice,
        user.id,
        patch.amount,
        override,
        id,
      );
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
