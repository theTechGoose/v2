import {
  Body,
  Context,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { WorkOrderStore } from "@paperwork/domain/data/work-order-store/mod.ts";
import { WorkOrderWorkerPort } from "@paperwork/domain/coordinators/work-order-worker-port/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";
import { requestIdOf } from "@core/business/request-id/mod.ts";
import { publisherOf } from "@paperwork/entrypoints/revisions-controller/mod.ts";
import {
  parseCreateWorkOrder,
  parseUpdateWorkOrder,
  type WorkOrder,
} from "@paperwork/dto/work-order.ts";
import { docNumberOf } from "#documents/numbering.ts";
import { versionOf } from "#documents/versions.ts";

/**
 * /work-orders — REQ-210 (A2Z): the contractor's numbered work orders.
 *
 *   GET    work-orders?customerId=&quoteId=&invoiceId=   → the account's list (newest number first)
 *   POST   work-orders   { description, customerId?, quoteId?, invoiceId?, … , requestId? }
 *   GET    work-orders/:id            → the order + `links` to its customer / quote / invoice
 *   PUT    work-orders/:id            → a new version (REQ-201), the number and id stay
 *   GET    work-orders/:id/versions   → every filed version + the current one
 *   DELETE work-orders/:id            → removed; its number is never reissued (REQ-198)
 */
@Controller("work-orders")
export class WorkOrderController {
  constructor(
    private store: WorkOrderStore,
    readonly quotes: QuoteStore,
    readonly invoices: InvoiceStore,
    readonly customers: CustomerStore,
    private users: UserStore,
    private sessions: SessionStore,
    readonly workers: WorkOrderWorkerPort, // REQ-1010; REQ-1022 covers
  ) {}

  @Get()
  async list(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const q = new URL(ctx.req.url).searchParams;
    const customerId = q.get("customerId");
    const quoteId = q.get("quoteId");
    const invoiceId = q.get("invoiceId");
    const rows = (await this.store.listByUser(user.id)).filter((w) =>
      (!customerId || w.customerId === customerId) &&
      (!quoteId || w.quoteId === quoteId) &&
      (!invoiceId || w.invoiceId === invoiceId)
    );
    const covers = await this.workers.coversOf(user.id, rows); // REQ-1022
    return ctx.json(rows.map((wo, i) => ({ ...summary(wo), ...covers[i] })));
  }

  @Post()
  async create(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const requestId = requestIdOf(ctx, body);
    let dto;
    try {
      dto = parseCreateWorkOrder(body);
    } catch (err) {
      return ctx.json({
        ok: false,
        reason: "invalid",
        detail: (err as Error).message,
      }, 400);
    }
    const bad = await assignWorker(this.workers, dto, user.id) ??
      await refuseSampleQuote(this.quotes, dto.quoteId, user.id);
    if (bad) return ctx.json(bad, 400);
    const created = await this.store.create(user.id, dto, { requestId });
    return ctx.json(await withLinks(this, created, user.id));
  }

  @Get(":id")
  async get(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const wo = await this.store.getOwned(id, user.id);
    return ctx.json(await withLinks(this, wo, user.id));
  }

  @Put(":id")
  async update(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    let dto;
    try {
      dto = parseUpdateWorkOrder(body);
    } catch (err) {
      return ctx.json({
        ok: false,
        reason: "invalid",
        detail: (err as Error).message,
      }, 400);
    }
    const bad = await assignWorker(this.workers, dto, user.id) ??
      await refuseSampleQuote(this.quotes, dto.quoteId, user.id);
    if (bad) return ctx.json(bad, 400);
    const by = await publisherOf(ctx, this.sessions, this.users, user);
    const next = await this.store.update(id, user.id, dto, by);
    return ctx.json(await withLinks(this, next, user.id));
  }

  @Get(":id/versions")
  async versions(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const wo = await this.store.getOwned(id, user.id);
    const filed = await this.store.listVersions(id, user.id);
    const { pendingRevision: _p, ...content } = wo;
    return ctx.json([
      ...filed,
      {
        version: versionOf(wo),
        publishedAt: wo.publishedAt,
        publishedBy: wo.publishedBy,
        content,
        current: true,
      },
    ]);
  }

  @Delete(":id")
  async remove(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    await this.store.delete(id, user.id);
    return ctx.json({ ok: true });
  }
}

// ---- module-level helpers (Danet registers every controller method as a route) ----

/**
 * REQ-1010 — the Assignee is one of the account's field workers: another
 * account's (or an unknown) worker id is refused; a picked worker with no
 * Assignee text gets the worker's name. "" on an edit unassigns (the store
 * drops the id), so it is not looked up.
 */
async function assignWorker(
  port: WorkOrderWorkerPort,
  dto: { assignee?: string; assigneeWorkerId?: string },
  userId: string,
): Promise<{ ok: false; reason: string; detail: string } | null> {
  const id = dto.assigneeWorkerId?.trim();
  if (dto.assigneeWorkerId === undefined) return null;
  if (id === "") {
    dto.assigneeWorkerId = "";
    return null;
  }
  const w = await port.find(id!, userId);
  if (!w) {
    return {
      ok: false,
      reason: "invalid",
      detail: "assigneeWorkerId is not one of this account's workers",
    };
  }
  dto.assigneeWorkerId = w.id;
  if (!dto.assignee?.trim()) dto.assignee = w.name;
  return null;
}

/**
 * REQ-1058 — a work order never links to the onboarding sample quote (P-15,
 * `isSample`; REQ-360: the sample never passes for real data).
 */
async function refuseSampleQuote(
  quotes: QuoteStore,
  quoteId: string | undefined,
  userId: string,
): Promise<{ ok: false; reason: string; detail: string } | null> {
  const id = quoteId?.trim();
  if (!id) return null;
  const q = await quotes.getOwned(id, userId).catch(() => null);
  if (!q?.isSample) return null;
  return {
    ok: false,
    reason: "invalid",
    detail: "quoteId is the onboarding sample quote, not a real quote",
  };
}

function summary(wo: WorkOrder) {
  return {
    ...wo,
    number: docNumberOf(wo),
    version: versionOf(wo),
    url: `/wo/${wo.id}`,
  };
}

/** REQ-205: the order with clickable links to the documents it belongs to. */
async function withLinks(
  deps: {
    quotes: QuoteStore;
    invoices: InvoiceStore;
    customers: CustomerStore;
    workers?: WorkOrderWorkerPort;
  },
  wo: WorkOrder,
  userId: string,
) {
  const [quote, invoice, customer] = await Promise.all([
    wo.quoteId
      ? deps.quotes.getOwned(wo.quoteId, userId).catch(() => null)
      : null,
    wo.invoiceId
      ? deps.invoices.getOwned(wo.invoiceId, userId).catch(() => null)
      : null,
    wo.customerId
      ? deps.customers.get(wo.customerId).then((
        c,
      ) => (c.userId === userId ? c : null)).catch(() => null)
      : null,
  ]);
  const [cover] = deps.workers
    ? await deps.workers.coversOf(userId, [wo])
    : [{}]; // REQ-1022
  return {
    ...summary(wo),
    ...cover,
    links: {
      ...(quote
        ? {
          quote: {
            id: quote.id,
            number: docNumberOf(quote),
            url: `/q/${quote.id}`,
          },
        }
        : {}),
      ...(invoice
        ? {
          invoice: {
            id: invoice.id,
            number: docNumberOf(invoice),
            url: `/i/${invoice.id}`,
          },
        }
        : {}),
      ...(customer
        ? {
          customer: {
            id: customer.id,
            number: docNumberOf(customer),
            name: customer.name,
            url: `/customers/${customer.id}`,
          },
        }
        : wo.customerSnapshot
        ? {
          customer: {
            id: wo.customerId,
            number: wo.customerSnapshot.number,
            name: wo.customerSnapshot.name,
          },
        }
        : {}),
    },
  };
}
