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
  type CreateInvoiceDto,
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
import {
  type ChangeOrderDelivery,
  changeOrderDeliveryOf,
} from "#documents/change-order-sent-line.ts"; // REQ-684
import { deriveUrgency } from "@paperwork/domain/business/invoice-urgency/mod.ts";
import { isOpenReceivable } from "@paperwork/domain/business/open-receivable/mod.ts";
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
  exportDateOf,
  exportRangeSuffix,
  filterByDateRange,
  filterInvoicesForExport,
  invoiceExportCsv,
  parseExportRange,
  parseExportStatus,
} from "#documents/exports.ts"; // REQ-208
import { appUrl } from "@users/domain/business/app-url/mod.ts";
import { invoiceCapDecision } from "#documents/ledger.ts"; // REQ-233
import { hasCreatedFor } from "@core/data/numbered-store/mod.ts";
import { InvoiceTranslatorPort } from "@paperwork/domain/coordinators/invoice-translator-port/mod.ts"; // REQ-497
import { PreviewInvoiceSend } from "@paperwork/domain/coordinators/preview-invoice-send/mod.ts"; // REQ-727
import { parseInvoiceSendPreviewQuery } from "#quote-flow/send-preview.ts"; // REQ-727
import { EventBus } from "@core/business/events/mod.ts";
import {
  invoiceIssuedEvent,
  isIssuingTransition,
} from "@paperwork/domain/business/owner-activity/mod.ts"; // REQ-566
import { billToCustomerPlan } from "@paperwork/domain/business/bill-to-customer/mod.ts"; // REQ-696
import { PaymentStore } from "@paperwork/domain/data/payment-store/mod.ts";
import {
  duplicateDraftOf,
  MAX_BULK_IDS,
  removalFor,
} from "#documents/removal.ts"; // REQ-627
import type { VoidedBy } from "@paperwork/dto/invoice.ts";
import { ForbiddenError, NotFoundError } from "@core/data/repository/mod.ts";
import { RenderInvoicePrintPdf } from "@paperwork/domain/coordinators/render-invoice-print-pdf/mod.ts"; // REQ-629

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

/**
 * REQ-497 (demo-loop cycle 3, m23): a standalone invoice's typed title and
 * concepts get their other-language text before the customer is sent the
 * link, so /i?lang=en on a Spanish-typed invoice reads English. Quote-linked
 * invoices take theirs from the quote. Returns the re-read invoice. (A module
 * function, not a controller method: Danet routes every method it finds.)
 */
async function translateStandalone(
  translator: InvoiceTranslatorPort | undefined,
  store: InvoiceStore,
  inv: Invoice,
  user: { id: string; language?: string },
): Promise<Invoice> {
  if (!translator || inv.quoteId) return inv;
  // REQ-710 (cycle 5, M4): its line items are translated too.
  const hasLines = (inv.lineItems ?? []).some((li) => li.description?.trim());
  if (!inv.jobName?.trim() && !inv.description?.trim() && !hasLines) {
    return inv;
  }
  await translator.run({
    userId: user.id,
    invoiceId: inv.id,
    // REQ-710: only a hint — the language the invoice was typed in wins.
    baseLang: user.language === "es" ? "es" : "en",
  });
  return await store.getOwned(inv.id, user.id);
}

/** REQ-566 (cycle 4, m11): tell the bus the owner issued this invoice — the
 *  dashboard's activity feed. A module function: Danet routes every method
 *  of a controller class, so no undecorated helper lives on it. */
async function announceIssued(
  bus: EventBus,
  customers: CustomerStore,
  userId: string,
  inv: { id: string; amount?: number; customerId?: string },
): Promise<void> {
  const customerName = inv.customerId
    ? await customers.getOwned(inv.customerId, userId)
      .then((c) => c.name || undefined, () => undefined)
    : undefined;
  await bus.emit(invoiceIssuedEvent(userId, inv, customerName));
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
    private bus: EventBus,
    private sendPreview: PreviewInvoiceSend,
    private payments: PaymentStore, // REQ-627
    private printPdf: RenderInvoicePrintPdf, // REQ-629
    private translator?: InvoiceTranslatorPort,
  ) {}

  /**
   * REQ-629: POST /invoices/pdf-batch { ids } — ONE print-ready PDF, each
   * invoice on its own page(s), in the order given. The owner's invoices
   * only (any other id → 404, nothing rendered); 1..500 ids.
   */
  @Post("pdf-batch")
  async pdfBatch(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const ids = parseIds(body);
    if (typeof ids === "string") {
      return ctx.json({ ok: false, reason: ids }, 400);
    }
    let bytes: Uint8Array;
    try {
      bytes = await this.printPdf.run(user.id, ids);
    } catch (e) {
      if (e instanceof NotFoundError || e instanceof ForbiddenError) {
        return ctx.json({ ok: false, reason: "not_found" }, 404);
      }
      throw e;
    }
    const day = new Date().toISOString().slice(0, 10);
    return new Response(bytes as BodyInit, {
      headers: {
        "content-type": "application/pdf",
        "content-length": String(bytes.length),
        "content-disposition": `attachment; filename="invoices-${day}.pdf"`,
        "cache-control": "no-store",
      },
    });
  }

  /**
   * REQ-627: POST /invoices/bulk-remove { ids, action: "delete" | "void", reason? }
   * — applies the per-invoice rules to each and reports what it skipped and why
   * (`must_void`, `must_delete`, `locked_paid`, `already_void`, `not_found`).
   */
  @Post("bulk-remove")
  async bulkRemove(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const ids = parseIds(body);
    if (typeof ids === "string") {
      return ctx.json({ ok: false, reason: ids }, 400);
    }
    const b = (body ?? {}) as { action?: string; reason?: unknown };
    if (b.action !== "delete" && b.action !== "void") {
      return ctx.json({ ok: false, reason: "invalid", field: "action" }, 400);
    }
    const by = await publisherOf(ctx, this.sessions, this.users, user);
    const reason = cleanReason(b.reason);
    const results: Array<{ id: string; outcome: string; reason?: string }> = [];
    for (const id of ids) {
      results.push({
        id,
        ...await removeOne(this.store, this.payments, id, user.id, b.action, {
          by,
          reason,
        }),
      });
    }
    const done = results.filter((r) => r.outcome !== "skipped").length;
    return ctx.json({
      ok: true,
      results,
      done,
      skipped: results.length - done,
    });
  }

  /**
   * REQ-627: void — the invoice stays (Cancelled, with who / when / why), the
   * customer's link says so and cannot be paid, payments stay attached.
   * Never-sent drafts are deleted instead (409 `must_delete`); paid is locked.
   */
  @Post(":id/void")
  async voidInvoice(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    // REQ-627 AMENDMENT: auth first, and the reason is optional — a bare POST is no 500
    const body = await optionalJsonBody(ctx);
    const by = await publisherOf(ctx, this.sessions, this.users, user);
    const r = await removeOne(this.store, this.payments, id, user.id, "void", {
      by,
      reason: cleanReason((body as { reason?: unknown } | null)?.reason),
    });
    if (r.outcome === "skipped") {
      return ctx.json(
        { ok: false, reason: r.reason },
        r.reason === "not_found" ? 404 : 409,
      );
    }
    return ctx.json(
      project(await this.store.getOwned(id, user.id), new Date()),
    );
  }

  /**
   * REQ-627: "Void & duplicate" — fix a mistake on a sent invoice: it is voided
   * and a fresh DRAFT copy (a new number) carries its content to correct.
   */
  @Post(":id/void-duplicate")
  async voidAndDuplicate(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    // REQ-627 AMENDMENT: auth first, and the reason is optional — a bare POST is no 500
    const body = await optionalJsonBody(ctx);
    const by = await publisherOf(ctx, this.sessions, this.users, user);
    const inv = await this.store.getOwned(id, user.id);
    const r = await removeOne(this.store, this.payments, id, user.id, "void", {
      by,
      reason: cleanReason((body as { reason?: unknown } | null)?.reason),
    });
    if (r.outcome === "skipped") {
      return ctx.json({ ok: false, reason: r.reason }, 409);
    }
    const draft = await this.store.create(
      user.id,
      parseCreateInvoice(
        duplicateDraftOf(
          inv as unknown as Record<string, unknown> & { id: string },
        ),
      ),
    );
    const voided = await this.store.update(id, user.id, {
      replacedBy: draft.id,
    });
    const now = new Date();
    return ctx.json({
      voided: project(voided, now),
      draft: project(draft, now),
    });
  }

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
    // Trigger approval: the alert emails + texts the CUSTOMER the /co link
    // (and the contractor a heads-up). REQ-684 (cycle 5, m39): wait for it and
    // answer with what reached the customer, so the panel says "Sent CO-001
    // to Maria by email (…)" like the chat (REQ-456). A failed alert never
    // fails the create — it comes back as `delivery.error`.
    return ctx.json({
      ...co,
      delivery: await alertCustomer(
        this.changeOrderAlert,
        co.id,
        `invoices/${id}/change-orders`,
      ),
    });
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
    // REQ-684 (cycle 5, m39): the re-sent alert's delivery, as on create.
    return ctx.json({
      ...co,
      delivery: await alertCustomer(
        this.changeOrderAlert,
        co.id,
        `invoices/${id}/change-orders/${coId}`,
      ),
    });
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
    // REQ-550 (demo-loop cycle 4, B1): a body that fails validation (e.g.
    // an amount past the $1bn cap) is the caller's error — 422, not a throw.
    let dto: CreateInvoiceDto;
    try {
      dto = parseCreateInvoice(body);
    } catch {
      return ctx.json({ error: "invalid_invoice" }, 422);
    }
    delete dto.replaces; // REQ-627: server-set by void-duplicate only

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

    // REQ-550 (demo-loop cycle 4, B1): an invoice issued at birth bills
    // someone — a customer (given, or the quote's) or a typed bill-to name.
    // Nobody to bill is a draft, never "sent".
    if (
      isIssuedAtBirth(dto.status) && !dto.customerId?.trim() &&
      !(typeof dto.billTo?.name === "string" && dto.billTo.name.trim())
    ) {
      return ctx.json({ error: "invoice_needs_recipient" }, 422);
    }
    // REQ-696 (demo-loop cycle 5, M5/M22): a typed bill-to name with no
    // customer is that customer — attached when the account has them, else
    // created — so the customers page, its owed total and the invoice list
    // all see whom the invoice bills.
    if (!dto.customerId?.trim()) {
      const plan = billToCustomerPlan(
        dto.billTo,
        await this.customers.listByUser(user.id),
      );
      if (plan) {
        dto.customerId = "attach" in plan
          ? plan.attach
          : (await this.customers.create(user.id, plan.create)).id;
      }
    }
    // REQ-206: an invoice issued at birth carries its sentAt.
    if (
      dto.status && dto.status !== "draft" && dto.status !== "scheduled" &&
      !dto.sentAt
    ) {
      dto.sentAt = new Date().toISOString();
    }
    // REQ-566 (cycle 4, m11): an invoice issued at birth is the owner's
    // activity — the dashboard feed says so. A REQ-200 retry returns the
    // invoice it already made and announces nothing twice.
    const retry = await hasCreatedFor(user.id, "invoice", requestId);
    const created = await this.store.create(user.id, dto, { requestId });
    if (!retry && isIssuingTransition(undefined, created.status)) {
      await announceIssued(this.bus, this.customers, user.id, created);
    }
    return project(
      await translateStandalone(this.translator, this.store, created, user),
      new Date(),
    );
  }

  @Get()
  async list(
    @Context() ctx: ExecutionContext,
    @Query("status") status?: string,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    // REQ-473 (demo-loop cycle 3, M8): `?status=open` is the money owed
    // right now — the REQ-397 open-receivable rule (sent/viewed/claimed and
    // the legacy partly-paid "pending", with a balance), not one status.
    const list = status === "open"
      ? (await this.store.listByUser(user.id)).filter(isOpenReceivable)
      : status
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
    @Query("from") fromQ?: string,
    @Query("to") toQ?: string,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    // REQ-795: an inclusive day range — issued day (else created) for all /
    // unpaid, the paid day for paid. A malformed day is 400.
    const range = parseExportRange(fromQ, toQ);
    if ("field" in range) {
      return ctx.json(
        { ok: false, reason: "invalid", field: range.field },
        400,
      );
    }
    const all = await this.store.listByUser(user.id);
    let rows: Invoice[];
    let filename: string;
    if (statusQ !== undefined) {
      const status = parseExportStatus(statusQ);
      if (!status) {
        return ctx.json({ ok: false, reason: "invalid", field: "status" }, 400);
      }
      const slice = status === "paid"
        ? "paid"
        : status === "unpaid"
        ? "unpaid"
        : "invoices";
      rows = filterByDateRange(
        filterInvoicesForExport(all, status),
        (i) => exportDateOf(slice, i),
        range.from,
        range.to,
      );
      filename = `invoices-${status}${exportRangeSuffix(range)}.csv`;
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
   * REQ-727 (demo-loop cycle 5, c4-M16): GET
   * /invoices/:id/send-preview?channel&lang&issuedDate&dueDate — the email
   * subject + body and the text the client gets if the invoice is sent now
   * (the send sheet's "What they'll get"), in the picked language, else the
   * invoice's own; with the dates the send will stamp. Sends nothing.
   */
  @Get(":id/send-preview")
  async preview(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
    @Query("channel") channel?: string,
    @Query("lang") lang?: string,
    @Query("issuedDate") issuedDate?: string,
    @Query("dueDate") dueDate?: string,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.sendPreview.run(user.id, {
      invoiceId: id,
      ...parseInvoiceSendPreviewQuery({ channel, lang, issuedDate, dueDate }),
    });
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
    // REQ-488: reject-claim / the next claim own these
    delete patch.claimRejectedAt;
    delete patch.claimRejectedMethod;
    // REQ-627: voiding has its own route and rules
    delete patch.voidedAt;
    delete patch.voidedBy;
    delete patch.voidReason;
    delete patch.replacedBy;
    const existing = await this.store.getOwned(id, user.id);
    if (patch.status === "void" && existing.status !== "void") {
      return ctx.json({ ok: false, reason: "use_void" }, 409);
    }
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
    const updated = await this.store.update(id, user.id, {
      ...content,
      ...meta,
    });
    // REQ-566 (cycle 4, m11): a draft / scheduled invoice issued by an edit.
    if (isIssuingTransition(existing.status, updated.status)) {
      await announceIssued(this.bus, this.customers, user.id, updated);
    }
    // REQ-497: a live edit of the title / concepts is translated afresh.
    // REQ-710 (cycle 5, M4): and of the line items.
    const retitled = "jobName" in content || "description" in content ||
      "lineItems" in content;
    return project(
      retitled
        ? await translateStandalone(this.translator, this.store, updated, user)
        : updated,
      new Date(),
    );
  }

  /** REQ-627: only a never-sent invoice with no payments is deleted; a sent
   *  one is voided instead (409 `must_void`); paid stays (409 `locked_paid`). */
  @Delete(":id")
  async delete(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    await this.store.getOwned(id, user.id);
    const r = await removeOne(this.store, this.payments, id, user.id, "delete");
    if (r.outcome === "skipped") {
      return ctx.json({ ok: false, reason: r.reason }, 409);
    }
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
   *  patch) and flips status back to `sent`.
   *
   *  REQ-488 (demo m56/m57): the rejection is recorded on the invoice
   *  (`claimRejectedAt` + the claimed method) so the customer's /i says the
   *  payment hasn't arrived, and an invoice `claim_rejected` event puts a
   *  newer row in the feed and closes the open claim notification — the
   *  topbar chip no longer reads "… says they paid". */
  @Post(":id/reject-claim")
  async rejectClaim(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const inv = await this.store.getOwned(id, user.id);
    if (inv.status !== "claimed") {
      return ctx.json({ ok: false, reason: "not_claimed" }, 409);
    }
    const method = inv.paymentIntent?.method;
    // `null` tells the store to explicitly clear the intent. A plain
    // `undefined` is filtered out and would leave the stale claim behind —
    // which confirm-payment would then happily turn into a bogus payment.
    await this.store.update(id, user.id, {
      status: "sent",
      paymentIntent: null,
      claimRejectedAt: new Date().toISOString(),
      claimRejectedMethod: method ?? null,
    });
    let customerName: string | undefined;
    if (inv.customerId) {
      customerName = await this.customers.getOwned(inv.customerId, user.id)
        .then((c) => c.name || undefined, () => undefined);
    }
    customerName ??= inv.paymentIntent?.claimedBy?.trim() || undefined;
    await this.bus.emit({
      userId: user.id,
      entityType: "invoice",
      entityId: id,
      action: "claim_rejected",
      data: {
        ...(method ? { method } : {}),
        ...(customerName ? { customerName } : {}),
        ...(inv.paymentIntent?.amount !== undefined
          ? { amountCents: inv.paymentIntent.amount }
          : {}),
      },
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

/** REQ-550: a create status that issues the invoice (anything but the
 *  unissued draft / scheduled tracks — an omitted status is a draft). */
function isIssuedAtBirth(status: string | undefined): boolean {
  return !!status && status !== "draft" && status !== "scheduled";
}

/** REQ-684 (cycle 5, m39): run the change-order alert and return what
 *  reached the customer; a thrown alert is reported, never raised. (Module
 *  scope: Danet routes every method on a controller class.) */
async function alertCustomer(
  alert: SendChangeOrderAlert,
  changeOrderId: string,
  where: string,
): Promise<ChangeOrderDelivery> {
  try {
    return changeOrderDeliveryOf(await alert.run(changeOrderId));
  } catch (err) {
    console.error(`[${where}] alert failed:`, err);
    return changeOrderDeliveryOf(
      undefined,
      err instanceof Error ? err.message : String(err),
    );
  }
}

/** REQ-627/629: `{ ids }` → the ids, or the 400 reason. */
function parseIds(body: unknown): string[] | "no_ids" | "too_many" | "invalid" {
  const ids = (body as { ids?: unknown } | null)?.ids;
  if (!Array.isArray(ids) || ids.some((i) => typeof i !== "string" || !i)) {
    return Array.isArray(ids) ? "invalid" : "no_ids";
  }
  if (ids.length === 0) return "no_ids";
  if (ids.length > MAX_BULK_IDS) return "too_many";
  return [...new Set(ids as string[])];
}

function cleanReason(r: unknown): string | undefined {
  return typeof r === "string" && r.trim() ? r.trim().slice(0, 500) : undefined;
}

/** REQ-627: apply the removal rules to one invoice. Never throws for a
 *  missing / foreign id — that is a skip with `not_found`. */
async function removeOne(
  store: InvoiceStore,
  payments: PaymentStore,
  id: string,
  userId: string,
  action: "delete" | "void",
  opts: { by?: VoidedBy; reason?: string } = {},
): Promise<{ outcome: "deleted" | "voided" | "skipped"; reason?: string }> {
  let inv: Invoice;
  try {
    inv = await store.getOwned(id, userId);
  } catch (e) {
    if (e instanceof NotFoundError || e instanceof ForbiddenError) {
      return { outcome: "skipped", reason: "not_found" };
    }
    throw e;
  }
  const paid = await payments.listByInvoice(id, userId).catch(() => []);
  const d = removalFor(inv, paid.length);
  if (d.action === "locked" || d.action === "none") {
    return { outcome: "skipped", reason: d.reason };
  }
  if (action === "delete") {
    if (d.action !== "delete") {
      return { outcome: "skipped", reason: "must_void" };
    }
    await store.delete(id, userId);
    return { outcome: "deleted" };
  }
  if (d.action !== "void") return { outcome: "skipped", reason: "must_delete" };
  await store.update(id, userId, {
    status: "void",
    voidedAt: new Date().toISOString(),
    ...(opts.by ? { voidedBy: opts.by } : {}),
    ...(opts.reason ? { voidReason: opts.reason } : {}),
  });
  return { outcome: "voided" };
}

/** REQ-627 AMENDMENT: the JSON body when one was sent, {} when none (a bare POST is a 500 through @Body) */
async function optionalJsonBody(ctx: ExecutionContext): Promise<unknown> {
  const raw = await ctx.req.text().catch(() => "");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
