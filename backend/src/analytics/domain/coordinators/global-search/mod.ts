import { Injectable } from "#danet/core";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { ChangeOrderStore } from "@paperwork/domain/data/change-order-store/mod.ts";
import { WorkOrderStore } from "@paperwork/domain/data/work-order-store/mod.ts";
import {
  type SearchHit,
  searchRecords,
  type SearchType,
} from "#documents/search.ts";

export type { SearchHit, SearchType };

export interface SearchOptions {
  q: string;
  /** Restrict to a single entity type. If omitted, searches all five. */
  type?: SearchType;
  /** Cap on per-type results. Default 10. */
  limit?: number;
}

/**
 * GlobalSearch — REQ-207: the dashboard's search box.
 *
 * Loads ONE account's customers, quotes, invoices, change orders and work
 * orders and hands them to the pure `searchRecords` (shared/documents/
 * search.ts), which matches numbers (full or partial, prefix-insensitive),
 * customer names and numbers, addresses, dates and job text, ranks exact
 * number hits first, then prefixes, then substrings, and attaches the
 * related records (an invoice's quote, a quote's invoices, a customer's
 * counts) to every row.
 *
 * Per-account scope is the store index: every list is `listByUser(userId)`,
 * so nothing from another account can enter the candidate set. A full scan
 * is fine up to ~10k records per account (REQ-135 made listByUser one
 * batched read); when it is not, index by token without changing the surface.
 */
@Injectable()
export class GlobalSearch {
  constructor(
    private customers: CustomerStore,
    private quotes: QuoteStore,
    private invoices: InvoiceStore,
    private changeOrders: ChangeOrderStore,
    private workOrders: WorkOrderStore,
  ) {}

  async run(userId: string, options: SearchOptions): Promise<SearchHit[]> {
    const q = options.q.trim();
    if (!q) return [];
    const [customers, quotes, invoices, changeOrders, workOrders] =
      await Promise.all([
        this.customers.listByUser(userId),
        this.quotes.listByUser(userId),
        this.invoices.listByUser(userId),
        this.changeOrders.listByUser(userId),
        this.workOrders.listByUser(userId),
      ]);
    return searchRecords(
      { customers, quotes, invoices, changeOrders, workOrders },
      q,
      {
        limit: options.limit ?? 10,
        ...(options.type ? { types: [options.type] } : {}),
      },
    );
  }
}
