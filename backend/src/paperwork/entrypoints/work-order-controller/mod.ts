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
    return ctx.json(rows.map(summary));
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
  return {
    ...summary(wo),
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
