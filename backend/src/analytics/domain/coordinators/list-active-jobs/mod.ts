import { Injectable } from "#danet/core";
import {
  classifyQuoteForPipeline,
  isSampleQuote,
  resolveJobCustomerId,
} from "#quote-flow/pipeline-stats.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import type { Customer } from "@crm/dto/customer.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";

/**
 * The view the dashboard's "Active jobs" panel renders.
 *
 * A "job" isn't a first-class entity — it's the synthesized status of
 * customer + accepted quote (the agreement) + paid/pending invoices. We
 * compute it on read by joining across stores rather than maintaining a
 * separate Jobs table; with KV scans bounded by user, this stays fast at
 * v1 scale.
 *
 * Status taxonomy (matches the prototype `JOBS` array):
 *   - 'on_track'  — quote accepted, invoices fully or partially paid, none overdue
 *   - 'awaiting_permit' — synthesized when customer note matches a permit-related keyword (heuristic; future: a real flag)
 *   - 'overdue'   — at least one invoice past dueDate
 *   - 'complete'  — all invoices paid
 */
export type JobStatusKind =
  | "on_track"
  | "awaiting_permit"
  | "overdue"
  | "complete";

export interface Job {
  /** Stable id formed from `quoteId` (the work originates from a quote). */
  id: string;
  customer: { id: string; name: string };
  /** Quote summary + estimated total (INTEGER CENTS — same unit as the
   *  rest of the job, see audit1 #3). Renamed from `estimatedTotal` to
   *  `estimatedTotalCents` to make the unit visible at the call site. */
  quote: { id: string; summary: string; estimatedTotalCents: number };
  totalCents: number;
  paidCents: number;
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
    private quotes: QuoteStore,
    private invoices: InvoiceStore,
  ) {}

  async run(userId: string, now: Date = new Date()): Promise<Job[]> {
    const [customers, quotes, invoices] = await Promise.all([
      this.customers.listByUser(userId),
      this.quotes.listByUser(userId),
      this.invoices.listByUser(userId),
    ]);

    const customerById = new Map<string, Customer>(
      customers.map((c) => [c.id, c]),
    );
    const invoicesByQuote = new Map<string, Invoice[]>();
    for (const i of invoices) {
      if (!i.quoteId) continue;
      const arr = invoicesByQuote.get(i.quoteId) ?? [];
      arr.push(i);
      invoicesByQuote.set(i.quoteId, arr);
    }

    const todayIso = now.toISOString().slice(0, 10);
    const out: Job[] = [];

    // Build one Job per WON quote — the customer accepted/signed (P-14).
    // A merely-sent quote is not a job: the panel's own empty-state promises
    // "jobs appear once a customer signs", and the KPI must agree.
    for (const q of quotes) {
      if (isSampleQuote(q)) continue; // P-15: the sample is never a job
      const cls = classifyQuoteForPipeline(
        {
          status: q.status,
          sentAt: q.sentAt,
          acceptedAt: q.acceptedAt,
          lostAt: q.lostAt,
        },
      );
      if (cls !== "won") continue;

      const customerId = resolveJobCustomerId(q);
      const customer = customerId ? customerById.get(customerId) : undefined;
      if (!customer) continue; // can't render a job without a customer

      const relatedInvoices = invoicesByQuote.get(q.id) ?? [];
      // Audit1 #3 — estimatedTotal and invoice.amount are INTEGER CENTS.
      const totalCents = q.estimatedTotal ?? 0;
      const paidCents = relatedInvoices
        .filter((i) => i.status === "paid")
        .reduce((sum, i) => sum + (i.amount ?? 0), 0);
      const pctPaid = totalCents > 0
        ? Math.round((paidCents / totalCents) * 100)
        : 0;

      const pendingInvoices = relatedInvoices.filter((i) =>
        i.status === "pending"
      );
      const overdueInvoices = pendingInvoices.filter((i) =>
        i.dueDate < todayIso
      );
      const allInvoicesPaid = relatedInvoices.length > 0 &&
        relatedInvoices.every((i) => i.status === "paid");

      let status: JobStatusKind;
      let statusLabel: string;
      if (allInvoicesPaid) {
        status = "complete";
        statusLabel = "Complete";
      } else if (overdueInvoices.length > 0) {
        status = "overdue";
        statusLabel = "Overdue";
      } else {
        status = "on_track";
        statusLabel = "On track";
      }

      const nextDueDate = pendingInvoices
        .map((i) => i.dueDate)
        .sort()[0] ?? null;

      out.push({
        id: q.id,
        customer: { id: customer.id, name: customer.name },
        quote: {
          id: q.id,
          summary: q.summary,
          estimatedTotalCents: q.estimatedTotal ?? 0,
        },
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
