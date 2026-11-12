import { Body, Context, Controller, Get, Param, Post } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { ChangeOrderStore } from "@paperwork/domain/data/change-order-store/mod.ts";
import { PaymentStore } from "@paperwork/domain/data/payment-store/mod.ts";
import { WorkOrderStore } from "@paperwork/domain/data/work-order-store/mod.ts"; // REQ-210
import { SendPaperworkEmail } from "@paperwork/domain/coordinators/send-paperwork-email/mod.ts";
import { SendPaperworkSms } from "@paperwork/domain/coordinators/send-paperwork-sms/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import {
  readSessionId,
  requireUser,
} from "@users/domain/coordinators/require-user/mod.ts";
import type { User } from "@users/dto/user.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";
import {
  type DocVersionRecord,
  invoiceBalance,
  isInvoiceLocked,
  isQuoteLocked,
  publisherOrOwner,
  versionOf,
} from "#documents/versions.ts";
import { quoteLedger } from "#documents/ledger.ts";
import { EventBus } from "@core/business/events/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";

/**
 * RevisionsController — REQ-201/202/205: publishing, versions, the ledger.
 *
 *   POST quotes/:id/publish    { notify?: boolean }  → the published quote (version +1)
 *   POST quotes/:id/discard-revision                  → the quote, its pending revision dropped (REQ-395)
 *   GET  quotes/:id/versions                          → every filed version + the current one
 *   GET  quotes/:id/ledger                            → invoices / change orders / totals
 *   POST invoices/:id/publish  { notify?: boolean }  → the published invoice (version +1)
 *   GET  invoices/:id/versions
 *
 * "Publish revision and notify customer" saves the pending revision as the
 * next version on the SAME number and link and re-sends that link; the
 * version it replaces is filed with who published it and when.
 */
@Controller()
export class RevisionsController {
  constructor(
    private quotes: QuoteStore,
    private invoices: InvoiceStore,
    private changeOrders: ChangeOrderStore,
    private payments: PaymentStore,
    private workOrders: WorkOrderStore,
    private email: SendPaperworkEmail,
    private sms: SendPaperworkSms,
    private users: UserStore,
    private sessions: SessionStore,
    private bus: EventBus,
    private customers: CustomerStore,
  ) {}

  @Post("quotes/:id/publish")
  async publishQuote(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const opts = publishOpts(body);
    const quote = await this.quotes.getOwned(id, user.id);
    if (isQuoteLocked(quote)) {
      return ctx.json({ ok: false, reason: "locked_signed" }, 409);
    }
    if (
      !quote.pendingRevision || Object.keys(quote.pendingRevision).length === 0
    ) {
      return ctx.json({ ok: false, reason: "nothing_to_publish" }, 409);
    }
    const by = await publisherOf(ctx, this.sessions, this.users, user);
    const published = await this.quotes.publishRevision(
      id,
      user.id,
      quote.pendingRevision,
      by,
    );
    await emitRevised(this.bus, this.customers, user.id, "quote", published);
    const notified = opts.notify
      ? await notify(this.email, this.sms, user.id, "quote", id, opts.language)
      : undefined;
    return ctx.json({ ...published, ...(notified ? { notified } : {}) });
  }

  /** REQ-395 (demo M12): throw away an unwanted draft revision; the customer's version is untouched. */
  @Post("quotes/:id/discard-revision")
  async discardQuoteRevision(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const quote = await this.quotes.getOwned(id, user.id);
    if (isQuoteLocked(quote)) {
      return ctx.json({ ok: false, reason: "locked_signed" }, 409);
    }
    return ctx.json(await this.quotes.clearPending(id, user.id));
  }

  @Get("quotes/:id/versions")
  async quoteVersions(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const quote = await this.quotes.getOwned(id, user.id);
    const filed = await this.quotes.listVersions(id, user.id);
    return ctx.json(await withNames(this.users, withCurrent(filed, quote)));
  }

  /** REQ-205: what was agreed, invoiced, paid, still owed, and still to invoice. */
  @Get("quotes/:id/ledger")
  async quoteLedger(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const quote = await this.quotes.getOwned(id, user.id);
    const [all, cos, wos] = await Promise.all([
      this.invoices.listByUser(user.id),
      this.changeOrders.listByQuote(user.id, id),
      this.workOrders.listByQuote(user.id, id),
    ]);
    const invoices = await Promise.all(
      all.filter((i) => i.quoteId === id).map((i) =>
        withPaid(this.payments, i)
      ),
    );
    return ctx.json(quoteLedger(quote, invoices, cos, wos));
  }

  @Post("invoices/:id/publish")
  async publishInvoice(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const opts = publishOpts(body);
    const invoice = await this.invoices.getOwned(id, user.id);
    if (isInvoiceLocked(invoice)) {
      return ctx.json({ ok: false, reason: "locked_paid" }, 409);
    }
    if (
      !invoice.pendingRevision ||
      Object.keys(invoice.pendingRevision).length === 0
    ) {
      return ctx.json({ ok: false, reason: "nothing_to_publish" }, 409);
    }
    const by = await publisherOf(ctx, this.sessions, this.users, user);
    const published = await this.invoices.publishRevision(
      id,
      user.id,
      invoice.pendingRevision,
      by,
      (next) => flagOverpayment(next),
    );
    await emitRevised(this.bus, this.customers, user.id, "invoice", published);
    const notified = opts.notify
      ? await notify(
        this.email,
        this.sms,
        user.id,
        "invoice",
        id,
        opts.language,
      )
      : undefined;
    return ctx.json({ ...published, ...(notified ? { notified } : {}) });
  }

  @Get("invoices/:id/versions")
  async invoiceVersions(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const invoice = await this.invoices.getOwned(id, user.id);
    const filed = await this.invoices.listVersions(id, user.id);
    return ctx.json(await withNames(this.users, withCurrent(filed, invoice)));
  }
}

// ---- module-level helpers (Danet registers every controller method as a route) ----

function publishOpts(
  body: unknown,
): { notify: boolean; language?: "en" | "es" } {
  const b = (body && typeof body === "object" ? body : {}) as {
    notify?: unknown;
    language?: unknown;
  };
  return {
    notify: b.notify === true,
    ...(b.language === "en" || b.language === "es"
      ? { language: b.language }
      : {}),
  };
}

/** REQ-201: who published — the admin acting for the account when there is one, else the owner. */
export async function publisherOf(
  ctx: ExecutionContext,
  sessions: SessionStore,
  users: UserStore,
  user: User,
): Promise<DocVersionRecord["publishedBy"]> {
  const sid = readSessionId(ctx);
  const session = sid ? await sessions.get(sid) : null;
  if (session?.actorId) {
    const actor = await users.get(session.actorId).catch(() => null);
    if (actor) {
      return { userId: actor.id, ...(actor.name ? { name: actor.name } : {}) };
    }
  }
  return { userId: user.id, ...(user.name ? { name: user.name } : {}) };
}

/**
 * REQ-564 (demo-loop cycle 4, m35): a publish is a domain event — the
 * notifications feed (topbar ticker, Activity) shows "Q-001 Version 2
 * published to María" instead of still reading "Quote sent".
 */
async function emitRevised(
  bus: EventBus,
  customers: CustomerStore,
  userId: string,
  entityType: "quote" | "invoice",
  doc: {
    id: string;
    number?: string;
    version?: number;
    customerId?: string;
    customerSnapshot?: { name?: string };
  },
): Promise<void> {
  const customerName =
    (doc.customerId
      ? await customers.getOwned(doc.customerId, userId).then(
        (c) => c.name?.trim() || undefined,
        () => undefined,
      )
      : undefined) ?? (doc.customerSnapshot?.name?.trim() || undefined);
  await bus.emit({
    userId,
    entityType,
    entityId: doc.id,
    action: "revised",
    data: {
      version: versionOf(doc),
      ...(doc.number ? { number: doc.number } : {}),
      ...(customerName ? { customerName } : {}),
    },
  });
}

/** The filed versions plus the live record as the current one, oldest first. */
function withCurrent(
  filed: DocVersionRecord[],
  live: {
    version?: number;
    userId?: string;
    publishedAt?: string;
    publishedBy?: DocVersionRecord["publishedBy"];
    sentAt?: string;
    updatedAt?: string;
    createdAt?: string;
    pendingRevision?: unknown;
  },
) {
  const { pendingRevision: _p, ...content } = live;
  return [
    ...filed.map((v) => ({
      ...v,
      // REQ-248: a version filed as published by {} was its owner's
      publishedBy: publisherOrOwner({
        publishedBy: v.publishedBy,
        userId: (v.content as { userId?: unknown })?.userId,
      }),
      current: false,
    })),
    {
      version: versionOf(live),
      // REQ-248: never published by nobody — the owner, when it was sent
      publishedAt: live.publishedAt ?? live.sentAt ?? live.updatedAt ??
        live.createdAt,
      publishedBy: publisherOrOwner(live),
      content,
      current: true,
    },
  ];
}

/**
 * REQ-248: every publisher named — a version stamped with a user id only
 * (the first issue, a send, a row from before the stamp) reads back with
 * that user's name as it is now.
 */
async function withNames<
  T extends { publishedBy: DocVersionRecord["publishedBy"] },
>(users: UserStore, versions: T[]): Promise<T[]> {
  const names = new Map<string, string | undefined>();
  for (const v of versions) {
    const id = v.publishedBy?.userId;
    if (id && !v.publishedBy.name && !names.has(id)) {
      const u = await users.get(id).catch(() => null);
      names.set(id, u?.name?.trim() || undefined);
    }
  }
  return versions.map((v) => {
    const id = v.publishedBy?.userId;
    const name = id && !v.publishedBy.name ? names.get(id) : undefined;
    return name ? { ...v, publishedBy: { ...v.publishedBy, name } } : v;
  });
}

/** REQ-202: an invoice with its confirmed payments summed (the stored paidCents, else the ledger). */
async function withPaid(
  payments: PaymentStore,
  invoice: Invoice,
): Promise<Invoice> {
  if (typeof invoice.paidCents === "number") return invoice;
  const rows = await payments.listByInvoice(invoice.id, invoice.userId).catch(
    () => [],
  );
  const paidCents = rows.reduce((s, p) => s + (p.amount ?? 0), 0);
  // an invoice marked paid before payments were recorded is paid in full
  if (rows.length === 0 && invoice.status === "paid") return invoice;
  return { ...invoice, paidCents };
}

/** REQ-202: a revision that drops the amount under what was paid is flagged, never hidden. */
export function flagOverpayment(next: Invoice): Invoice {
  const { overpaidCents } = invoiceBalance(next.amount, next.paidCents ?? 0);
  const out = { ...next };
  if (overpaidCents > 0) out.overpaidCents = overpaidCents;
  else delete out.overpaidCents;
  return out;
}

/** Re-send the document's existing link by email and text (best effort; the publish already happened). */
async function notify(
  email: SendPaperworkEmail,
  sms: SendPaperworkSms,
  userId: string,
  kind: "quote" | "invoice",
  resourceId: string,
  language?: "en" | "es",
): Promise<
  {
    email?: { ok: boolean; reason?: string };
    sms?: { ok: boolean; reason?: string };
  }
> {
  const out: {
    email?: { ok: boolean; reason?: string };
    sms?: { ok: boolean; reason?: string };
  } = {};
  try {
    const r = await email.run(userId, {
      kind,
      resourceId,
      ...(language ? { language } : {}),
    });
    out.email = { ok: r.ok, ...(r.reason ? { reason: r.reason } : {}) };
  } catch (err) {
    out.email = { ok: false, reason: (err as Error).message };
  }
  try {
    const r = await sms.run(userId, {
      kind,
      resourceId,
      ...(language ? { language } : {}),
    });
    out.sms = { ok: r.ok, ...(r.reason ? { reason: r.reason } : {}) };
  } catch (err) {
    out.sms = { ok: false, reason: (err as Error).message };
  }
  return out;
}
