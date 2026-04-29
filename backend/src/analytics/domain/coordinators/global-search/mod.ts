import { Injectable } from "#danet/core";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { QuoteStore }    from "@paperwork/domain/data/quote-store/mod.ts";
import { ContractStore } from "@paperwork/domain/data/contract-store/mod.ts";
import { InvoiceStore }  from "@paperwork/domain/data/invoice-store/mod.ts";

/**
 * Result of a `⌘K` search hit. Discriminated by `type` so the frontend
 * can render the right icon + open the right destination.
 */
export type SearchHit =
  | { type: "customer"; id: string; label: string; sub?: string }
  | { type: "quote";    id: string; label: string; sub?: string; total?: number }
  | { type: "contract"; id: string; label: string; sub?: string }
  | { type: "invoice";  id: string; label: string; sub?: string; amount?: number };

export interface SearchOptions {
  q: string;
  /** Restrict to a single entity type. If omitted, searches all four. */
  type?: SearchHit["type"];
  /** Cap on per-type results. Default 10 (so 4×10 = 40 max with full scan). */
  limit?: number;
}

/**
 * GlobalSearch — substring search across customers, quotes, contracts,
 * invoices for the topbar `⌘K`.
 *
 * Per-user scope; full scan + filter is fine up to ~10k records per
 * tenant. When that becomes a bottleneck, swap for a per-token KV index
 * or a real search engine without changing the surface.
 *
 * Match rules:
 *   - case-insensitive substring
 *   - searches `name`/`summary`/`quoteId`/`contractId` etc. — see per-type
 *     impl below
 *   - empty query returns []
 */
@Injectable()
export class GlobalSearch {
  constructor(
    private customers: CustomerStore,
    private quotes:    QuoteStore,
    private contracts: ContractStore,
    private invoices:  InvoiceStore,
  ) {}

  async run(userId: string, options: SearchOptions): Promise<SearchHit[]> {
    const q = options.q.trim().toLowerCase();
    if (!q) return [];
    const limit = options.limit ?? 10;
    const results: SearchHit[] = [];

    if (!options.type || options.type === "customer") {
      const customers = await this.customers.listByUser(userId);
      for (const c of customers) {
        if (matches(q, c.name, c.email, c.phoneNumber, c.address, c.notes)) {
          results.push({ type: "customer", id: c.id, label: c.name, sub: c.email ?? c.phoneNumber });
          if (perTypeCount(results, "customer") >= limit) break;
        }
      }
    }

    if (!options.type || options.type === "quote") {
      const quotes = await this.quotes.listByUser(userId);
      for (const q1 of quotes) {
        if (matches(q, q1.summary, q1.id)) {
          results.push({ type: "quote", id: q1.id, label: q1.summary, sub: q1.status, total: q1.estimatedTotal });
          if (perTypeCount(results, "quote") >= limit) break;
        }
      }
    }

    if (!options.type || options.type === "contract") {
      const contracts = await this.contracts.listByUser(userId);
      for (const c of contracts) {
        if (matches(q, c.id, c.quoteId, c.status)) {
          results.push({ type: "contract", id: c.id, label: `Contract ${c.id.slice(0, 8)}…`, sub: c.status });
          if (perTypeCount(results, "contract") >= limit) break;
        }
      }
    }

    if (!options.type || options.type === "invoice") {
      const invoices = await this.invoices.listByUser(userId);
      for (const i of invoices) {
        if (matches(q, i.id, i.contractId, i.status)) {
          results.push({ type: "invoice", id: i.id, label: `Invoice ${i.id.slice(0, 8)}…`, sub: i.status, amount: i.amount });
          if (perTypeCount(results, "invoice") >= limit) break;
        }
      }
    }

    return results;
  }
}

function matches(needle: string, ...haystacks: Array<string | undefined>): boolean {
  return haystacks.some((h) => typeof h === "string" && h.toLowerCase().includes(needle));
}

function perTypeCount(results: SearchHit[], type: SearchHit["type"]): number {
  return results.filter((r) => r.type === type).length;
}
