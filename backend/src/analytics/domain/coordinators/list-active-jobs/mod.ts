import { Injectable } from "#danet/core";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { QuoteStore }    from "@paperwork/domain/data/quote-store/mod.ts";
import { ContractStore } from "@paperwork/domain/data/contract-store/mod.ts";
import { InvoiceStore }  from "@paperwork/domain/data/invoice-store/mod.ts";
import type { Customer } from "@crm/dto/customer.ts";
import type { Quote }    from "@paperwork/dto/quote.ts";
import type { Contract } from "@paperwork/dto/contract.ts";
import type { Invoice }  from "@paperwork/dto/invoice.ts";

/**
 * The view the dashboard's "Active jobs" panel renders.
 *
 * A "job" isn't a first-class entity — it's the synthesized status of
 * customer + signed contract + paid/pending invoices. We compute it on
 * read by joining across stores rather than maintaining a separate Jobs
 * table; with KV scans bounded by user, this stays fast at v1 scale.
 *
 * Status taxonomy (matches the prototype `JOBS` array):
 *   - 'awaiting'  — quote accepted but contract still draft
 *   - 'on_track'  — contract signed, invoices fully or partially paid, none overdue
 *   - 'awaiting_permit' — synthesized when customer note matches a permit-related keyword (heuristic; future: a real flag)
 *   - 'overdue'   — at least one invoice past dueDate
 *   - 'complete'  — all invoices paid AND contract signed
 */
export type JobStatusKind = "awaiting" | "on_track" | "awaiting_permit" | "overdue" | "complete";

export interface Job {
  /** Stable id formed from `quoteId` (the work originates from a quote). */
  id: string;
  customer:   { id: string; name: string };
  /** Quote summary + estimated total (INTEGER CENTS — same unit as the
   *  rest of the job, see audit1 #3). Renamed from `estimatedTotal` to
   *  `estimatedTotalCents` to make the unit visible at the call site. */
  quote:      { id: string; summary: string; estimatedTotalCents: number };
  contract:   { id: string; status?: string } | null;
  totalCents: number;
  paidCents:  number;
  /** 0..100 — paid / total. */
  pctPaid: number;
  /** Earliest pending due date among invoices (ISO yyyy-mm-dd) — null when none pending. */
  nextDueDate: string | null;
  status: JobStatusKind;
  statusLabel: string;
}

@Injectable()
export class ListActiveJobs {
  constructor(
    private customers: CustomerStore,
    private quotes:    QuoteStore,
    private contracts: ContractStore,
    private invoices:  InvoiceStore,
  ) {}

  async run(userId: string, now: Date = new Date()): Promise<Job[]> {
    const [customers, quotes, contracts, invoices] = await Promise.all([
      this.customers.listByUser(userId),
      this.quotes.listByUser(userId),
      this.contracts.listByUser(userId),
      this.invoices.listByUser(userId),
    ]);

    const customerById = new Map<string, Customer>(customers.map((c) => [c.id, c]));
    const contractsByQuote = new Map<string, Contract>();
    for (const c of contracts) contractsByQuote.set(c.quoteId, c);
    const invoicesByContract = new Map<string, Invoice[]>();
    for (const i of invoices) {
      const arr = invoicesByContract.get(i.contractId) ?? [];
      arr.push(i);
      invoicesByContract.set(i.contractId, arr);
    }

    const todayIso = now.toISOString().slice(0, 10);
    const out: Job[] = [];

    // Build one Job per quote where the customer has *committed* in some way:
    // either accepted (so a contract is implied) or there's already a contract.
    for (const q of quotes) {
      if (q.status !== "accepted" && q.status !== "sent") continue;
      const contract = q.id ? contractsByQuote.get(q.id) : undefined;

      const customer = q.customerId ? customerById.get(q.customerId) : undefined;
      if (!customer) continue;          // can't render a job without a customer

      const relatedInvoices = contract ? (invoicesByContract.get(contract.id) ?? []) : [];
      // Audit1 #3 — totalAmount, estimatedTotal, and invoice.amount are all
      // INTEGER CENTS now. The previous schema multiplied by 100 here.
      const totalCents = contract?.totalAmount ?? q.estimatedTotal ?? 0;
      const paidCents  = relatedInvoices
        .filter((i) => i.status === "paid")
        .reduce((sum, i) => sum + (i.amount ?? 0), 0);
      const pctPaid    = totalCents > 0 ? Math.round((paidCents / totalCents) * 100) : 0;

      const pendingInvoices = relatedInvoices.filter((i) => i.status === "pending");
      const overdueInvoices = pendingInvoices.filter((i) => i.dueDate < todayIso);
      const allInvoicesPaid = relatedInvoices.length > 0 && relatedInvoices.every((i) => i.status === "paid");

      let status: JobStatusKind;
      let statusLabel: string;
      if (allInvoicesPaid && contract?.status === "signed") {
        status = "complete";
        statusLabel = "Complete";
      } else if (overdueInvoices.length > 0) {
        status = "overdue";
        statusLabel = "Overdue";
      } else if (!contract || contract.status !== "signed") {
        status = "awaiting";
        statusLabel = "Awaiting signature";
      } else {
        status = "on_track";
        statusLabel = "On track";
      }

      const nextDueDate = pendingInvoices
        .map((i) => i.dueDate)
        .sort()[0] ?? null;

      out.push({
        id:         q.id,
        customer:   { id: customer.id, name: customer.name },
        quote:      { id: q.id, summary: q.summary, estimatedTotalCents: q.estimatedTotal ?? 0 },
        contract:   contract ? { id: contract.id, status: contract.status } : null,
        totalCents,
        paidCents,
        pctPaid,
        nextDueDate,
        status,
        statusLabel,
      });
    }

    // Newest first (use quote createdAt; quote.id alone won't sort).
    out.sort((a, b) => (a.id < b.id ? 1 : -1));
    return out;
  }
}
