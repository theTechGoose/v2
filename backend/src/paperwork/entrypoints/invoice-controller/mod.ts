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
import { requestIdOf } from "@core/business/request-id/mod.ts";
import {
  INVOICE_CONTENT_FIELDS,
  invoiceEditDecision,
  isInvoiceLocked,
  splitPatch,
} from "#documents/versions.ts";
import {
  flagOverpayment,
  publisherOf,
} from "@paperwork/entrypoints/revisions-controller/mod.ts";
import {
  filterInvoicesForExport,
  invoiceExportCsv,
  parseExportStatus,
} from "#documents/exports.ts"; // REQ-208
import { appUrl } from "@users/domain/business/app-url/mod.ts";
import { invoiceCapDecision } from "#documents/ledger.ts"; // REQ-233
import { hasCreatedFor } from "@core/data/numbered-store/mod.ts";

/** number order for an export (INV-001 before INV-002; unnumbered rows by age) */
const bySeq = (
  a: { seq?: number; createdAt?: string },
  b: { seq?: number; createdAt?: string },
) =>
  (a.seq ?? 0) - (b.seq ?? 0) ||
  (a.createdAt ?? "").localeCompare(b.createdAt ?? "");

function project(invoice: Invoice, now: Date): Invoice {
  return { ...invoice, urgency: deriveUrgency(invoice, now) };
}

@Controller("invoices")
export class InvoiceController {
  constructor(
    private store: InvoiceStore,
    private customers: CustomerStore,
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
    // REQ-202: a paid invoice is locked — more work gets a new invoice.
    if (isInvoiceLocked(inv)) {
      return ctx.json({ ok: false, reason: "locked_paid" }, 409);
    }
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
    const patch = {
      amount: newAmount,
      discountCents: (inv.discountCents ?? 0) + cents,
      ...(b.reason ? { discountReason: b.reason } : {}),
    };
    // REQ-201: a discount the customer will see is a published revision —
    // same number, same link, next version — on an issued invoice; a draft
    // just changes.
    const updated =
      inv.status && inv.status !== "draft" && inv.status !== "scheduled"
        ? await this.store.publishRevision(
          id,
          user.id,
          patch,
          await publisherOf(ctx, this.sessions, this.users, user),
          (next) => flagOverpayment(next),
        )
        : await this.store.update(id, user.id, patch);
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
    // REQ-202: a paid invoice is locked — additional work gets a new invoice.
    if (isInvoiceLocked(inv)) {
      return ctx.json({ ok: false, reason: "locked_paid" }, 409);
    }
    const requestId = requestIdOf(ctx, body); // REQ-200
    const dto = parseCreateChangeOrder(body);
    const co = await this.changeOrders.create(user.id, id, {
      ...dto,
      ...(inv.quoteId ? { quoteId: inv.quoteId } : {}),
      ...(inv.customerId ? { customerId: inv.customerId } : {}),
      // Freeze the pre-change total — the public page renders its math from
      // this snapshot so revisiting the link after approval stays correct.
      originalAmountCents: inv.amount ?? 0,
    }, { requestId });
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
    const requestId = requestIdOf(ctx, body); // REQ-200
    // REQ-233: the over-billing acknowledgement is a request flag, never a field.
    const override = (body as { override?: unknown } | null)?.override ===
      true;
    if (body && typeof body === "object") {
      delete (body as { override?: unknown }).override;
    }
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
      // REQ-233 (demo B2): one billing source per agreement. A new invoice on
      // a quote bills at most what the ledger still has unbilled (quote total
      // + approved change orders − every non-void invoice on it), so signing
      // a 50/50 quote and then "Send as Invoice" can never bill it twice.
      // Extra work billed on purpose says so with `override: true`; a REQ-200
      // retry of a create that already landed gets its invoice back.
      if (
        !override && !(await hasCreatedFor(user.id, "invoice", requestId))
      ) {
        const [siblings, cos] = await Promise.all([
          this.store.listByUser(user.id).then((all) =>
            all.filter((i) => i.quoteId === q.id)
          ),
          this.changeOrders.listByQuote(user.id, q.id),
        ]);
        const cap = invoiceCapDecision(
          q,
          siblings,
          cos,
          dto.amount ?? 0,
          dto.taxCents ?? 0,
        );
        if (!cap.ok) return ctx.json(cap, 409);
      }
    }
    // Every invoice gets a due date; +30 days is the trade default.
    if (!dto.dueDate) {
      dto.dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        .toISOString().slice(0, 10);
    }

    // REQ-206: an invoice issued at birth carries its sentAt.
    if (
      dto.status && dto.status !== "draft" && dto.status !== "scheduled" &&
      !dto.sentAt
    ) {
      dto.sentAt = new Date().toISOString();
    }
    return project(
      await this.store.create(user.id, dto, { requestId }),
      new Date(),
    );
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

  /**
   * REQ-208: the invoice export. `?status=all|paid|unpaid` exports those
   * invoices with every agreed column (customer and addresses, service
   * dates, quote and change-order numbers, amounts in dollars, the public
   * link). Without `status` it is the tax-time export it always was: the
   * invoices paid in `?year=` (default this year) and, with `?month=1..12`
   * (REQ-019 / NW-33 "Export this month"), in that month — same columns.
   * Declared BEFORE the `:id` route: Danet matches in declaration order and
   * `:id` used to swallow "export.csv" as an invoice id (404).
   */
  @Get("export.csv")
  async exportCsv(
    @Context() ctx: ExecutionContext,
    @Query("year") yearQ?: string,
    @Query("month") monthQ?: string,
    @Query("status") statusQ?: string,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const all = await this.store.listByUser(user.id);
    let rows: Invoice[];
    let filename: string;
    if (statusQ !== undefined) {
      const status = parseExportStatus(statusQ);
      if (!status) {
        return ctx.json({ ok: false, reason: "invalid", field: "status" }, 400);
      }
      rows = filterInvoicesForExport(all, status);
      filename = `invoices-${status}.csv`;
    } else {
      const year = yearQ ? Number(yearQ) : new Date().getUTCFullYear();
      const month = monthQ ? Number(monthQ) : undefined;
      if (
        month !== undefined &&
        !(Number.isInteger(month) && month >= 1 && month <= 12)
      ) {
        return ctx.json({ ok: false, reason: "invalid", field: "month" }, 400);
      }
      rows = all.filter((i) => {
        if (i.status !== "paid" || !i.paidAt) return false;
        const d = new Date(i.paidAt);
        if (d.getUTCFullYear() !== year) return false;
        return month === undefined || d.getUTCMonth() + 1 === month;
      });
      filename = `invoices-${year}${
        month !== undefined ? `-${String(month).padStart(2, "0")}` : ""
      }.csv`;
    }
    const [customers, quotes, changeOrders] = await Promise.all([
      this.customers.listByUser(user.id),
      this.quotes.listByUser(user.id),
      this.changeOrders.listByUser(user.id),
    ]);
    const customerById = new Map(customers.map((c) => [c.id, c]));
    const quoteById = new Map(quotes.map((q) => [q.id, q]));
    const cosByInvoice = new Map<string, ChangeOrder[]>();
    for (const co of changeOrders) {
      const list = cosByInvoice.get(co.invoiceId);
      if (list) list.push(co);
      else cosByInvoice.set(co.invoiceId, [co]);
    }
    const base = appUrl();
    const csv = invoiceExportCsv(rows.slice().sort(bySeq), {
      customerOf: (
        i,
      ) => (i.customerId ? customerById.get(i.customerId) : undefined),
      quoteOf: (i) => (i.quoteId ? quoteById.get(i.quoteId) : undefined),
      changeOrdersOf: (i) => (cosByInvoice.get(i.id) ?? []).slice().sort(bySeq),
      linkOf: (i) => `${base}/i/${i.id}`,
    });
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  @Get(":id")
  async get(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return project(await this.store.getOwned(id, user.id), new Date());
  }

  /**
   * REQ-201/202: a draft or scheduled invoice edits live. Once issued, a
   * content edit waits as a pending revision until POST /invoices/:id/publish
   * (the customer's link keeps showing the published version). A paid
   * invoice refuses content edits (409 `locked_paid`). Bookkeeping fields
   * (status, paidAt, reminders, the claim) always apply.
   */
  @Put(":id")
  async update(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const patch = parseUpdateInvoice(body);
    // never from a request: the balance coordinator owns these
    delete patch.paidCents;
    delete patch.overpaidCents;
    const existing = await this.store.getOwned(id, user.id);
    const decision = invoiceEditDecision(
      existing,
      patch as unknown as Record<string, unknown>,
    );
    if (decision.mode === "locked") {
      return ctx.json({
        ok: false,
        reason: decision.reason,
        fields: decision.fields,
      }, 409);
    }
    const { content, meta } = splitPatch(
      patch as unknown as Record<string, unknown>,
      INVOICE_CONTENT_FIELDS,
    );
    const issuing = typeof meta.status === "string" &&
      meta.status !== "draft" && meta.status !== "scheduled";
    if (issuing && !existing.sentAt && !meta.sentAt) {
      meta.sentAt = new Date().toISOString();
    }
    if (decision.mode === "pending") {
      const updated = Object.keys(meta).length
        ? await this.store.update(id, user.id, meta)
        : existing;
      const pending = await this.store.setPending(id, user.id, content);
      return project({ ...updated, ...pending }, new Date());
    }
    return project(
      await this.store.update(id, user.id, { ...content, ...meta }),
      new Date(),
    );
  }

  @Delete(":id")
  async delete(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const inv = await this.store.getOwned(id, user.id);
    // REQ-202: a paid invoice is part of the record — it stays.
    if (isInvoiceLocked(inv)) {
      return ctx.json({ ok: false, reason: "locked_paid" }, 409);
    }
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
 *  helpers must be free functions (like `bySeq` above). */
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
