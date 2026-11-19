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
import {
  matchesQuery,
  pageOf,
  sortByName,
} from "@analytics/domain/business/clients-page/mod.ts"; // REQ-135 — the one set of paging rules
import type { ExecutionContext } from "#danet/core";
import {
  CustomerStore,
  StaleCustomerVersionError,
} from "@crm/domain/data/customer-store/mod.ts";
import { versionOf } from "#documents/versions.ts"; // REQ-1144
import { parseCreateCustomer, parseUpdateCustomer } from "@crm/dto/customer.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts"; // REQ-208
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts"; // REQ-208
import { customerOpenReceivables } from "@paperwork/domain/business/open-receivable/mod.ts"; // REQ-1138
import {
  customerExportCsv,
  exportDateOf,
  exportRangeSuffix,
  filterByDateRange,
  parseExportRange,
} from "#documents/exports.ts"; // REQ-208, REQ-795

@Controller("customers")
export class CustomerController {
  constructor(
    private store: CustomerStore,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  @Post()
  async create(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.store.create(user.id, parseCreateCustomer(body));
  }

  /** the array, as always; REQ-135 — `?page=`, `?pageSize=` or `?q=` asks for one page: `{ items, page, pageSize, total, totalPages }` */
  @Get()
  async list(
    @Context() ctx: ExecutionContext,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("q") q?: string,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const all = await this.store.listByUser(user.id);
    if (page === undefined && pageSize === undefined && q === undefined) {
      return all;
    }
    return pageOf(
      sortByName(all.filter((c) => matchesQuery(c, q))),
      Number(page),
      Number(pageSize),
    );
  }

  /**
   * REQ-208: every customer as CSV — number, name, business, email, phone,
   * address, created, their quote and invoice numbers, the open balance.
   * Declared BEFORE `:id` so "export.csv" is never read as a customer id.
   * The paperwork stores are plain KV readers (no DI state), built here so
   * the CRM module does not have to import the paperwork module.
   */
  @Get("export.csv")
  async exportCsv(
    @Context() ctx: ExecutionContext,
    @Query("from") fromQ?: string,
    @Query("to") toQ?: string,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    // REQ-795: an inclusive day range on the day the customer was added
    const range = parseExportRange(fromQ, toQ);
    if ("field" in range) {
      return ctx.json(
        { ok: false, reason: "invalid", field: range.field },
        400,
      );
    }
    const [allCustomers, quotes, invoices] = await Promise.all([
      this.store.listByUser(user.id),
      new QuoteStore().listByUser(user.id),
      new InvoiceStore().listByUser(user.id),
    ]);
    const customers = filterByDateRange(
      allCustomers,
      (c) => exportDateOf("customers", c),
      range.from,
      range.to,
    );
    const ordered = customers.slice().sort((a, b) =>
      (a.seq ?? 0) - (b.seq ?? 0) ||
      (a.createdAt ?? "").localeCompare(b.createdAt ?? "")
    );
    return new Response(customerExportCsv(ordered, quotes, invoices), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="customers${
          exportRangeSuffix(range)
        }.csv"`,
      },
    });
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
    try {
      return await this.store.update(id, user.id, parseUpdateCustomer(body));
    } catch (e) {
      // REQ-1144 (LOOP-007 q3, q3-74): an edit made on an older version is
      // refused, never silently written over the newer one — the reply
      // carries the latest customer so the form can show it
      if (e instanceof StaleCustomerVersionError) {
        return ctx.json({
          error: "stale_version",
          currentVersion: versionOf(e.current),
          customer: e.current,
        }, 409);
      }
      throw e;
    }
  }

  /**
   * REQ-802 soft delete. REQ-1138 (LOOP-007 q3, q3-69): a customer who still owes money (an open
   * receivable on the REQ-397 rule) is refused 409 `{code:"customer_owes", owedCents, invoices}` so
   * the debt never loses its owner silently; `?force=1` is the owner's explicit "Delete anyway".
   */
  @Delete(":id")
  async delete(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
    @Query("force") force?: string,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    await this.store.getOwned(id, user.id); // 404 before anything is said about her balance
    if (force !== "1" && force !== "true") {
      const owes = customerOpenReceivables(
        await new InvoiceStore().listByUser(user.id),
        id,
      );
      if (owes.owedCents > 0) {
        return ctx.json({ ok: false, code: "customer_owes", ...owes }, 409);
      }
    }
    await this.store.delete(id, user.id);
    return { ok: true };
  }
}
