import { Injectable } from "#danet/core";
import {
  aggregatePipeline,
  isSampleQuote,
} from "#quote-flow/pipeline-stats.ts";
import { isUndelivered } from "#quote-flow/delivery.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { PaymentStore } from "@paperwork/domain/data/payment-store/mod.ts";
import { PAYMENT_METHODS, type PaymentMethod } from "@paperwork/dto/payment.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";
import type { Payment } from "@paperwork/dto/payment.ts";
import { bucketPendingInvoices } from "@paperwork/domain/business/invoice-aging-buckets/mod.ts";
import { isOpenReceivable } from "@paperwork/domain/business/open-receivable/mod.ts";
import { completedJobsInYear } from "@analytics/domain/business/signed-jobs/mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { threadFlowOf } from "@agents/domain/coordinators/list-conversations/mod.ts";
import { threadStatus } from "#quote-flow/chat-header.ts";
import type { Quote } from "@paperwork/dto/quote.ts";
import {
  bucketBy12Months,
  lastMonthRevenue,
  monthOverMonthPct,
  type RevenueRow,
  ytdRevenue,
} from "@core/business/sparkline/mod.ts";
import type {
  DashboardStats,
  TopPayor,
} from "@analytics/dto/dashboard-stats.ts";

/**
 * ComputeDashboardStats — fans across CRM + Paperwork stores (all already
 * scoped by userId) and rolls everything into a single DashboardStats
 * payload for `GET /analytics/dashboard`.
 *
 * Pure read coordinator. No new storage. Cheap enough to call on every
 * dashboard mount; if it ever gets slow the caching layer goes here.
 *
 * Money fields are CENTS — see DashboardStats doc.
 */
@Injectable()
export class ComputeDashboardStats {
  constructor(
    private customers: CustomerStore,
    private quotes: QuoteStore,
    private invoices: InvoiceStore,
    private payments: PaymentStore,
    private conversations: AgentConversationStore,
  ) {}

  async run(userId: string, now: Date = new Date()): Promise<DashboardStats> {
    // Four parallel listByUser scans. Each is in-memory after the KV index
    // hit, so they're cheap. If we add 1000-customer accounts this becomes
    // the place to introduce per-resource counters.
    const [customers, quotes, invoices, payments] = await Promise.all([
      this.customers.listByUser(userId),
      this.quotes.listByUser(userId),
      this.invoices.listByUser(userId),
      this.payments.listByUser(userId),
    ]);

    // P-15: the onboarding sample contributes to NOTHING — every quote
    // aggregate below rolls over real quotes only.
    const realQuotes = quotes.filter((q) => !isSampleQuote(q));

    const quoteCounts = {
      total: realQuotes.length,
      draft: realQuotes.filter((q) => q.status === "draft").length,
      sent: realQuotes.filter((q) => q.status === "sent").length,
      accepted: realQuotes.filter((q) => q.status === "accepted").length,
      // REQ-566 (demo-loop cycle 4, m11): of the drafts, those whose send
      // reached nobody — the dashboard says "Not delivered", not "ready".
      undelivered: realQuotes.filter((q) =>
        q.status === "draft" && isUndelivered(q)
      ).length,
      readyToSend: await this.countReadyToSend(
        userId,
        realQuotes.filter((q) => q.status === "draft"),
      ),
    };

    const todayIso = now.toISOString().slice(0, 10);
    // REQ-397 (demo-loop cycle 2, M14): "pending" = open receivables (sent /
    // viewed / claimed, unpaid) — accept writes "sent", never "pending".
    const open = invoices.filter(isOpenReceivable);
    const invoiceCounts = {
      total: invoices.length,
      pending: open.length,
      paid: invoices.filter((i) => i.status === "paid").length,
      overdue: open.filter((i) => i.dueDate < todayIso).length,
      agingBuckets: bucketPendingInvoices(invoices, now),
    };

    // Quoted value: sum of estimatedTotal across quotes that are still
    // open (sent but not accepted/declined). Audit1 #3 — estimatedTotal
    // is now stored as INTEGER CENTS, so this is a passthrough sum.
    const quotedValueCents = realQuotes
      .filter((q) => q.status === "sent")
      .reduce((sum, q) => sum + (q.estimatedTotal ?? 0), 0);

    // UX-02: the won bucket — the accepted value must not vanish the moment
    // a quote leaves "sent". Samples contribute nothing (P-15 discipline).
    const wonValueCents =
      aggregatePipeline(quotes.map((q) => ({ ...q }))).wonCents;

    // Revenue rows: each paid invoice contributes amount → revenue. Invoice
    // amounts are also INTEGER CENTS now (no × 100 needed).
    const revenueRows: RevenueRow[] = invoices
      .filter((i) => i.status === "paid" && i.paidAt)
      .map((i) => ({
        paidAt: i.paidAt!,
        amountCents: i.amount ?? 0,
      }));

    const paidJobs = completedJobsInYear(invoices, now.getUTCFullYear());

    return {
      customers: customers.length,
      quotes: quoteCounts,
      invoices: invoiceCounts,
      quotedValueCents,
      wonValueCents,
      awaitingResponse: quoteCounts.sent,
      revenue: {
        ytdCents: ytdRevenue(revenueRows, now),
        // REQ-698 (demo-loop cycle 5, m14): completed jobs only — a paid
        // deposit on a $1,450 job read "AVG. PAID JOB $725".
        paidJobsYtd: paidJobs.count,
        paidJobsYtdCents: paidJobs.cents,
        lastMonthCents: lastMonthRevenue(revenueRows, now),
        monthOverMonthPct: monthOverMonthPct(revenueRows, now),
        sparkline12mo: bucketBy12Months(revenueRows, now),
      },
      payments: computePaymentStats(payments, invoices, now),
    };
  }

  /**
   * REQ-698 (demo-loop cycle 5, m14): of the drafts, those the thread status
   * calls "Ready to send" — the terms wizard finished and no job-details pick
   * owed (the SAME rule as the chat header and the thread list). Pair 10's
   * dashboard said "1 draft is ready to send" while the draft was mid-wizard.
   */
  private async countReadyToSend(
    userId: string,
    drafts: Quote[],
  ): Promise<number> {
    if (drafts.length === 0) return 0;
    const convs = await this.conversations.listByUser(userId, { limit: 500 })
      .catch(() => []);
    // listByUser is newest-first: the first thread naming a quote is its own
    const convByQuote = new Map<string, (typeof convs)[number]>();
    for (const c of convs) {
      if (c.quoteId && !convByQuote.has(c.quoteId)) convByQuote.set(c.quoteId, c);
    }
    const statuses = await Promise.all(drafts.map(async (quote) => {
      const conv = convByQuote.get(quote.id);
      const flow = conv ? await threadFlowOf(this.conversations, conv) : {};
      return threadStatus({ quote, ...flow });
    }));
    return statuses.filter((s) => s === "readyToSend").length;
  }
}

function computePaymentStats(
  payments: Payment[],
  invoices: Invoice[],
  now: Date,
) {
  // Audit1 #3 — Payment.amount is INTEGER CENTS, so all the previous
  // dollar→cents conversions in this function become identity copies.
  const yearStart = `${now.getUTCFullYear()}-01-01T00:00:00.000Z`;
  const receivedYtdCents = payments
    .filter((p) => p.receivedAt >= yearStart)
    .reduce((sum, p) => sum + (p.amount ?? 0), 0);

  const methodMixCents = Object.fromEntries(
    PAYMENT_METHODS.map((m) => [m, 0]),
  ) as Record<PaymentMethod, number>;
  for (const p of payments) {
    methodMixCents[p.method] = (methodMixCents[p.method] ?? 0) +
      (p.amount ?? 0);
  }

  const invoiceCustomer = new Map(
    invoices.map((i) => [i.id, i.customerId ?? ""]),
  );
  const totalsByCustomer = new Map<string, number>();
  for (const p of payments) {
    const customerId = invoiceCustomer.get(p.invoiceId) ?? "";
    if (!customerId) continue;
    totalsByCustomer.set(
      customerId,
      (totalsByCustomer.get(customerId) ?? 0) + (p.amount ?? 0),
    );
  }
  const topPayors: TopPayor[] = [...totalsByCustomer.entries()]
    .map(([customerId, totalCents]) => ({ customerId, totalCents }))
    .sort((a, b) => b.totalCents - a.totalCents)
    .slice(0, 3);

  return { receivedYtdCents, methodMixCents, topPayors };
}
