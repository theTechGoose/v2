import { Injectable } from "#danet/core";
import { resolveJobCustomerId } from "#quote-flow/pipeline-stats.ts";
import {
  isJobComplete,
  isSignedJob,
} from "@analytics/domain/business/signed-jobs/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import type { Customer } from "@crm/dto/customer.ts";
import { ChangeOrderStore } from "@paperwork/domain/data/change-order-store/mod.ts";
import type { ChangeOrder } from "@paperwork/dto/change-order.ts";
import { agreedTotalCents } from "#documents/ledger.ts"; // REQ-679
import type { Invoice } from "@paperwork/dto/invoice.ts";
import {
  isOpenReceivable,
  isUpcomingReceivable,
} from "@paperwork/domain/business/open-receivable/mod.ts";

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
  quote: {
    id: string;
    summary: string;
    estimatedTotalCents: number;
    /** REQ-497 (demo-loop cycle 3, m23): the quote's title per language, so
     *  the dashboard row renders quoteJobTitle(job.quote, lang) — the /quotes
     *  rule (REQ-394) — instead of the primary summary. */
    jobName?: string;
    jobNameByLang?: Record<string, string>;
    summaryByLang?: Record<string, string>;
  };
  totalCents: number;
  paidCents: number;
  /** 0..100 — paid / total. */
  pctPaid: number;
  /** Earliest due date among the open receivables (ISO yyyy-mm-dd); with
   *  none open, the earliest SCHEDULED installment's due date (REQ-473) —
   *  null only when nothing is owed or upcoming. */
  nextDueDate: string | null;
  /** REQ-473 (demo-loop cycle 3, M8): the quote's agreed payment terms (the
   *  stored EN wizard value, e.g. "Payment upon completion", "50 / 50") so the
   *  row can say "Due on completion" instead of a blanket "Deposit". */
  paymentTerms: string | null;
  status: JobStatusKind;
  statusLabel: string;
}

@Injectable()
export class ListActiveJobs {
  constructor(
    private customers: CustomerStore,
    private quotes: QuoteStore,
    private invoices: InvoiceStore,
    /** REQ-679: approved change orders are part of the job's total */
    private changeOrders: ChangeOrderStore = new ChangeOrderStore(),
  ) {}

  async run(userId: string, now: Date = new Date()): Promise<Job[]> {
    const [customers, quotes, invoices, cos] = await Promise.all([
      this.customers.listByUser(userId),
      this.quotes.listByUser(userId),
      this.invoices.listByUser(userId),
      this.changeOrders.listByUser(userId).catch(() => [] as ChangeOrder[]),
    ]);
    const cosByQuote = new Map<string, ChangeOrder[]>();
    for (const co of cos) {
      if (!co.quoteId) continue;
      const arr = cosByQuote.get(co.quoteId) ?? [];
      arr.push(co);
      cosByQuote.set(co.quoteId, arr);
    }

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
    // REQ-562: the shared signed-job rule (the sample is never a job, P-15).
    for (const q of quotes) {
      if (!isSignedJob(q)) continue;

      const customerId = resolveJobCustomerId(q);
      const customer = customerId ? customerById.get(customerId) : undefined;
      if (!customer) continue; // can't render a job without a customer

      const relatedInvoices = invoicesByQuote.get(q.id) ?? [];
      // Audit1 #3 — estimatedTotal and invoice.amount are INTEGER CENTS.
      // REQ-679 (cycle 5, M19): the job's total is the agreement — the quote
      // plus its approved change orders (the ledger's agreementTotalCents).
      const totalCents = agreedTotalCents(
        { estimatedTotal: q.estimatedTotal ?? 0 },
        cosByQuote.get(q.id) ?? [],
      );
      const paidCents = relatedInvoices
        .filter((i) => i.status === "paid")
        .reduce((sum, i) => sum + (i.amount ?? 0), 0);
      const pctPaid = totalCents > 0
        ? Math.round((paidCents / totalCents) * 100)
        : 0;

      // REQ-397 (demo-loop cycle 2, M14): owed = open receivables, not the
      // legacy "pending" accept never writes (the card read "No due date").
      const pendingInvoices = relatedInvoices.filter(isOpenReceivable);
      const overdueInvoices = pendingInvoices.filter((i) =>
        i.dueDate < todayIso
      );
      // REQ-562: the shared rule /clients counts by — every non-void
      // invoice paid; a scheduled installment keeps the job in flight.
      const allInvoicesPaid = isJobComplete(relatedInvoices);

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

      // REQ-473 (demo-loop cycle 3, M8): with nothing open, the next bill is
      // the earliest scheduled installment — not "No due date".
      const upcomingInvoices = relatedInvoices.filter(isUpcomingReceivable);
      const nextDueDate = earliestDue(pendingInvoices) ??
        earliestDue(upcomingInvoices);
      const paymentTerms = q.terms?.find((t) => t.stepId === "payment_terms")
        ?.value?.trim() || null;

      out.push({
        id: q.id,
        customer: { id: customer.id, name: customer.name },
        quote: {
          id: q.id,
          summary: q.summary,
          estimatedTotalCents: q.estimatedTotal ?? 0,
          ...(q.jobName ? { jobName: q.jobName } : {}),
          ...(q.jobNameByLang ? { jobNameByLang: q.jobNameByLang } : {}),
          ...(q.summaryByLang ? { summaryByLang: q.summaryByLang } : {}),
        },
        totalCents,
        paidCents,
        pctPaid,
        nextDueDate,
        paymentTerms,
        status,
        statusLabel,
      });
    }

    // Newest first (use quote createdAt; quote.id alone won't sort).
    out.sort((a, b) => (a.id < b.id ? 1 : -1));
    return out;
  }
}

function earliestDue(invoices: Invoice[]): string | null {
  return invoices.map((i) => i.dueDate).filter(Boolean).sort()[0] ?? null;
}
