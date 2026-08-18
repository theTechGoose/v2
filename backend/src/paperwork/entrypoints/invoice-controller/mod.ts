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
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { ContractStore } from "@paperwork/domain/data/contract-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import {
  type Invoice,
  parseCreateInvoice,
  parseUpdateInvoice,
} from "@paperwork/dto/invoice.ts";
import { ChangeOrderStore } from "@paperwork/domain/data/change-order-store/mod.ts";
import {
  type ChangeOrder,
  parseCreateChangeOrder,
} from "@paperwork/dto/change-order.ts";
import { SendChangeOrderAlert } from "@paperwork/domain/coordinators/send-change-order-alert/mod.ts";
import { deriveUrgency } from "@paperwork/domain/business/invoice-urgency/mod.ts";
import { ConfirmPayment } from "@paperwork/domain/coordinators/confirm-payment/mod.ts";
import { ComputeInvoiceForecast } from "@paperwork/domain/coordinators/compute-invoice-forecast/mod.ts";
import { RecordPaymentFromUtterance } from "@paperwork/domain/coordinators/record-payment-from-utterance/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";
import {
  canAdjustInvoice,
  isChangeOrderMutable,
} from "#quote-flow/adjustment-guards.ts";

function project(invoice: Invoice, now: Date): Invoice {
  return { ...invoice, urgency: deriveUrgency(invoice, now) };
}

@Controller("invoices")
export class InvoiceController {
  constructor(
    private store: InvoiceStore,
    private customers: CustomerStore,
    private contracts: ContractStore,
    private quotes: QuoteStore,
    private confirm: ConfirmPayment,
    private forecast: ComputeInvoiceForecast,
    private recordFromUtterance: RecordPaymentFromUtterance,
    private changeOrders: ChangeOrderStore,
    private changeOrderAlert: SendChangeOrderAlert,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  /** Apply a discount to an invoice in place (roadmap p.12). Reduces the
   *  net `amount` and records the cumulative `discountCents` for display. */
  @Post(":id/discount")
  async discount(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const b = (body ?? {}) as {
      discountCents?: number;
      reason?: string;
      /** Explicit "I know a payment claim is pending" acknowledgement. */
      acknowledgeClaim?: boolean;
      override?: boolean;
    };
    const cents = Math.max(0, Math.round(Number(b.discountCents ?? 0)));
    if (!cents) throw new Error("discountCents must be a positive integer");
    const inv = await this.store.getOwned(id, user.id);
    // P-41 integrity guard: an UNCONFIRMED payment claim means the customer
    // already claimed the OLD total — never silently change it under them.
    // 409 with a machine-readable reason unless explicitly acknowledged.
    const decision = canAdjustInvoice({
      paymentIntent: inv.paymentIntent ? { ...inv.paymentIntent } : null,
    });
    const acknowledged = b.acknowledgeClaim === true || b.override === true;
    if (decision.requiresWarning && !acknowledged) {
      return ctx.json(
        {
          ok: false,
          blocked: true,
          requiresConfirmation: true,
          reason: decision.reason ?? "unconfirmed-payment-claim",
        },
        409,
      );
    }
    const newAmount = Math.max(0, (inv.amount ?? 0) - cents);
    const updated = await this.store.update(id, user.id, {
      amount: newAmount,
      discountCents: (inv.discountCents ?? 0) + cents,
      ...(b.reason ? { discountReason: b.reason } : {}),
    });
    return ctx.json(project(updated, new Date()));
  }

  /** Create a change order against an invoice. Returns the order (pending);
   *  the customer approves it via /co/:id, which applies the delta. */
  @Post(":id/change-orders")
  async createChangeOrder(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const inv = await this.store.getOwned(id, user.id);
    const dto = parseCreateChangeOrder(body);
    const co = await this.changeOrders.create(user.id, id, {
      ...dto,
      ...(inv.contractId ? { contractId: inv.contractId } : {}),
      ...(inv.customerId ? { customerId: inv.customerId } : {}),
      // Freeze the pre-change total — the public page renders its math from
      // this snapshot so revisiting the link after approval stays correct.
      originalAmountCents: inv.amount ?? 0,
    });
    // Trigger approval: alert the contractor (email + SMS) with the shareable
    // /co link to send the customer. Fire-and-forget — delivery problems must
    // never fail the create.
    this.changeOrderAlert.run(co.id).catch((err) =>
      console.error(`[invoices/${id}/change-orders] alert failed:`, err)
    );
    return ctx.json(co);
  }

  /**
   * Edit a change order (roadmap p.12). Editing RE-OPENS approval: the order
   * resets to `pending`, the contractor is re-alerted with the link, and the
   * customer must approve the revised amount. If the prior version was already
   * `approved`, its delta is first reverted from the live invoice so the new
   * approval doesn't stack on top of the old one.
   */
  @Put(":id/change-orders/:coId")
  async editChangeOrder(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
    @Param("coId") coId: string,
    @Body() body: unknown,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const existing = await this.changeOrders.getOwned(coId, user.id);
    // P-41: a customer-APPROVED change order is immutable — the customer
    // signed off on that exact description + delta.
    if (!isChangeOrderMutable(existing)) {
      return ctx.json(
        { ok: false, reason: "approved-change-order-immutable" },
        409,
      );
    }
    const dto = parseCreateChangeOrder(body);
    // Revert any already-applied delta, then re-snapshot against the resulting
    // live total so the customer's fresh approval math is correct.
    const invAmount = await revertApprovedDelta(this.store, existing, user.id);
    const co = await this.changeOrders.update(coId, user.id, {
      description: dto.description,
      deltaAmountCents: dto.deltaAmountCents,
      originalAmountCents: invAmount,
    });
    this.changeOrderAlert.run(co.id).catch((err) =>
      console.error(`[invoices/${id}/change-orders/${coId}] alert failed:`, err)
    );
    return ctx.json(co);
  }

  /** Delete a change order. If it was already approved, its delta was applied
   *  to the live invoice — revert that first so deleting it doesn't leave a
   *  phantom amount behind. Pending/declined orders never touched the invoice. */
  @Delete(":id/change-orders/:coId")
  async deleteChangeOrder(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
    @Param("coId") coId: string,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const existing = await this.changeOrders.getOwned(coId, user.id);
    // P-41: a customer-APPROVED change order is immutable — deleting it would
    // silently rewrite an amount the customer already agreed to.
    if (!isChangeOrderMutable(existing)) {
      return ctx.json(
        { ok: false, reason: "approved-change-order-immutable" },
        409,
      );
    }
    // Pending/declined orders never touched the invoice — nothing to revert.
    await this.changeOrders.delete(coId, user.id);
    return ctx.json({ ok: true });
  }

  /** List change orders for an invoice. */
  @Get(":id/change-orders")
  async listChangeOrders(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return ctx.json(await this.changeOrders.listByInvoice(user.id, id));
  }

  @Post()
  async create(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const dto = parseCreateInvoice(body);

    // Derive-from-quote (roadmap p.6): the invoice carries all the quote's
    // information — job name, description, customer, line items, amount —
    // without re-entry. Explicit fields on the request still win.
    if (dto.quoteId) {
      const q = await this.quotes.getOwned(dto.quoteId, user.id);
      dto.jobName ??= q.jobName ?? q.summary;
      dto.description ??= q.description;
      dto.customerId ??= q.customerId;
      dto.lineItems ??= q.lineItems;
      dto.amount ??= q.estimatedTotal ??
        ((q.lineItems ?? []).reduce(
          (s, li) => s + (li.price ?? 0) * (li.quantity ?? 1),
          0,
        ) || undefined);
      if (!dto.contractId) {
        const contract = (await this.contracts.listByUser(user.id))
          .filter((c) => c.quoteId === q.id)
          .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))[0];
        if (contract) dto.contractId = contract.id;
      }
    }
    // Every invoice gets a due date; +30 days is the trade default.
    if (!dto.dueDate) {
      dto.dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        .toISOString().slice(0, 10);
    }

    return project(await this.store.create(user.id, dto), new Date());
  }

  @Get()
  async list(
    @Context() ctx: ExecutionContext,
    @Query("status") status?: string,
  ) {
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
  async update(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return project(
      await this.store.update(id, user.id, parseUpdateInvoice(body)),
      new Date(),
    );
  }

  @Delete(":id")
  async delete(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    await this.store.delete(id, user.id);
    return { ok: true };
  }

  /** Contractor confirms a customer's claimed payment. Records a Payment
   *  row, flips the invoice to paid, fires the PDF receipt. */
  @Post(":id/confirm-payment")
  async confirmPayment(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const result = await this.confirm.run(user.id, id);
    return ctx.json(result, result.ok ? 200 : 409);
  }

  /** "Didn't get it" — reopens an invoice the customer claimed but the
   *  contractor never actually received. Clears the intent (via store
   *  patch) and flips status back to `sent`. */
  @Post(":id/reject-claim")
  async rejectClaim(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const inv = await this.store.getOwned(id, user.id);
    if (inv.status !== "claimed") {
      return ctx.json({ ok: false, reason: "not_claimed" }, 409);
    }
    // `null` tells the store to explicitly clear the intent. A plain
    // `undefined` is filtered out and would leave the stale claim behind —
    // which confirm-payment would then happily turn into a bogus payment.
    await this.store.update(id, user.id, {
      status: "sent",
      paymentIntent: null,
    });
    return ctx.json({ ok: true });
  }

  /** Forecast hero data for /invoices. */
  @Get("forecast/this-week")
  async forecastThisWeek(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return ctx.json(await this.forecast.run(user.id, new Date()));
  }

  /** Tax-time CSV export. Streams CSV bytes for the given year. */
  @Get("export.csv")
  async exportCsv(
    @Context() ctx: ExecutionContext,
    @Query("year") yearQ?: string,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const year = yearQ ? Number(yearQ) : new Date().getUTCFullYear();
    const all = await this.store.listByUser(user.id);
    const paid = all.filter((i) => {
      if (i.status !== "paid" || !i.paidAt) return false;
      const d = new Date(i.paidAt);
      return d.getUTCFullYear() === year;
    });
    // Hydrate customer + job context for the export rows. Best-effort.
    const customerCache = new Map<string, string>();
    const contractCache = new Map<string, string>();
    const rows: string[][] = [[
      "Date",
      "Customer",
      "Job",
      "Amount",
      "Method",
      "Reference",
    ]];
    for (const inv of paid) {
      const customerName = await resolveName(
        this.customers,
        user.id,
        inv.customerId,
        customerCache,
      );
      const jobName = await resolveJobName(
        this.contracts,
        this.quotes,
        user.id,
        inv.contractId,
        contractCache,
      );
      // Payment intent at the moment-of-paid carries the method/reference.
      // After confirm clears the intent, we lose this — for v1 we mirror
      // it into the row at confirm-time (already happens via the Payment
      // entity, but listing payments per invoice would require a join we
      // skip here; fall back to the intent if still present).
      const method = inv.paymentIntent?.method ?? "—";
      const reference = inv.paymentIntent?.reference ?? "";
      rows.push([
        inv.paidAt!.slice(0, 10),
        customerName ?? "—",
        jobName ?? "—",
        ((inv.amount ?? 0) / 100).toFixed(2),
        method,
        reference,
      ]);
    }
    const csv = rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="invoices-${year}.csv"`,
      },
    });
  }

  /** Voice-driven payment recording: contractor's transcript → matched
   *  invoice → Payment + receipt fired (via ConfirmPayment internally).
   *  Returns either a confirmation or a disambiguation list. */
  @Post("record-payment/voice")
  async recordFromVoice(
    @Context() ctx: ExecutionContext,
    @Body() body: unknown,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const b = (body ?? {}) as { transcript?: string };
    if (typeof b.transcript !== "string" || !b.transcript.trim()) {
      throw new Error("transcript is required");
    }
    return ctx.json(
      await this.recordFromUtterance.run(user.id, { transcript: b.transcript }),
    );
  }

  /** Photo-driven payment recording: OCR fields parsed client-side
   *  (amount, payer name, check #) → matched invoice → recorded. */
  @Post("record-payment/photo")
  async recordFromPhoto(
    @Context() ctx: ExecutionContext,
    @Body() body: unknown,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const b = (body ?? {}) as {
      amount?: number;
      payerHint?: string;
      method?: string;
      reference?: string;
    };
    return ctx.json(
      await this.recordFromUtterance.run(user.id, {
        ocrFields: {
          ...(typeof b.amount === "number" ? { amount: b.amount } : {}),
          ...(b.payerHint ? { payerHint: b.payerHint } : {}),
          ...(b.method ? { method: b.method } : {}),
          ...(b.reference ? { reference: b.reference } : {}),
        },
      }),
    );
  }
}

/** Revert an already-approved change order's delta from its invoice (shared by
 *  the edit + delete handlers so the "approved → undo" invariant lives in one
 *  place). Returns the resulting invoice amount — unchanged when the order was
 *  never approved — for re-snapshotting. Module-level on purpose: Danet
 *  registers every *class method* on a controller as a route, so controller
 *  helpers must be free functions (see resolveName/resolveJobName below). */
async function revertApprovedDelta(
  store: InvoiceStore,
  co: ChangeOrder,
  userId: string,
): Promise<number> {
  const inv = await store.getOwned(co.invoiceId, userId);
  const current = inv.amount ?? 0;
  if (co.status !== "approved") return current;
  const reverted = Math.max(0, current - co.deltaAmountCents);
  await store.update(co.invoiceId, userId, { amount: reverted });
  return reverted;
}

async function resolveName(
  customers: CustomerStore,
  userId: string,
  customerId: string | undefined,
  cache: Map<string, string>,
): Promise<string | undefined> {
  if (!customerId) return undefined;
  if (cache.has(customerId)) return cache.get(customerId);
  try {
    const c = await customers.getOwned(customerId, userId);
    cache.set(customerId, c.name);
    return c.name;
  } catch {
    return undefined;
  }
}

async function resolveJobName(
  contracts: ContractStore,
  quotes: QuoteStore,
  userId: string,
  contractId: string | undefined,
  cache: Map<string, string>,
): Promise<string | undefined> {
  if (!contractId) return undefined;
  if (cache.has(contractId)) return cache.get(contractId);
  try {
    const c = await contracts.getOwned(contractId, userId);
    if (!c.quoteId) return undefined;
    const q = await quotes.getOwned(c.quoteId, userId);
    const name = q.jobName?.trim() || q.summary?.trim() || undefined;
    if (name) cache.set(contractId, name);
    return name;
  } catch {
    return undefined;
  }
}

function csvCell(s: string): string {
  // Standard RFC 4180 escaping: wrap in quotes if comma/quote/newline,
  // and double interior quotes.
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
