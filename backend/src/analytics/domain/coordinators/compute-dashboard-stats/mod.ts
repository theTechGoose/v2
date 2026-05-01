import { Injectable } from "#danet/core";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { ContractStore } from "@paperwork/domain/data/contract-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { PaymentStore } from "@paperwork/domain/data/payment-store/mod.ts";
import { PAYMENT_METHODS, type PaymentMethod } from "@paperwork/dto/payment.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";
import type { Payment } from "@paperwork/dto/payment.ts";
import { bucketPendingInvoices } from "@paperwork/domain/business/invoice-aging-buckets/mod.ts";
import {
  bucketBy12Months,
  lastMonthRevenue,
  monthOverMonthPct,
  type RevenueRow,
  ytdRevenue,
} from "@core/business/sparkline/mod.ts";
import type { DashboardStats, TopPayor } from "@analytics/dto/dashboard-stats.ts";

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
    private quotes:    QuoteStore,
    private contracts: ContractStore,
    private invoices:  InvoiceStore,
    private payments:  PaymentStore,
  ) {}

  async run(userId: string, now: Date = new Date()): Promise<DashboardStats> {
    // Five parallel listByUser scans. Each is in-memory after the KV index
    // hit, so they're cheap. If we add 1000-customer accounts this becomes
    // the place to introduce per-resource counters.
    const [customers, quotes, contracts, invoices, payments] = await Promise.all([
      this.customers.listByUser(userId),
      this.quotes.listByUser(userId),
      this.contracts.listByUser(userId),
      this.invoices.listByUser(userId),
      this.payments.listByUser(userId),
    ]);

    const quoteCounts = {
      total:    quotes.length,
      draft:    quotes.filter((q) => q.status === "draft").length,
      sent:     quotes.filter((q) => q.status === "sent").length,
      accepted: quotes.filter((q) => q.status === "accepted").length,
    };

    const contractCounts = {
      total:  contracts.length,
      draft:  contracts.filter((c) => c.status === "draft").length,
      signed: contracts.filter((c) => c.status === "signed").length,
    };

    const todayIso = now.toISOString().slice(0, 10);
    const invoiceCounts = {
      total:        invoices.length,
      pending:      invoices.filter((i) => i.status === "pending").length,
      paid:         invoices.filter((i) => i.status === "paid").length,
      overdue:      invoices.filter((i) => i.status === "pending" && i.dueDate < todayIso).length,
      agingBuckets: bucketPendingInvoices(invoices, now),
    };

    // Quoted value: sum of estimatedTotal across quotes that are still
    // open (sent but not accepted/declined). Audit1 #3 — estimatedTotal
    // is now stored as INTEGER CENTS, so this is a passthrough sum.
    const quotedValueCents = quotes
      .filter((q) => q.status === "sent")
      .reduce((sum, q) => sum + (q.estimatedTotal ?? 0), 0);

    // Revenue rows: each paid invoice contributes amount → revenue. Invoice
    // amounts are also INTEGER CENTS now (no × 100 needed).
    const revenueRows: RevenueRow[] = invoices
      .filter((i) => i.status === "paid" && i.paidAt)
      .map((i) => ({
        paidAt: i.paidAt!,
        amountCents: i.amount ?? 0,
      }));

    return {
      customers: customers.length,
      quotes:    quoteCounts,
      contracts: contractCounts,
      invoices:  invoiceCounts,
      quotedValueCents,
      awaitingResponse: quoteCounts.sent,
      revenue: {
        ytdCents:           ytdRevenue(revenueRows, now),
        lastMonthCents:     lastMonthRevenue(revenueRows, now),
        monthOverMonthPct:  monthOverMonthPct(revenueRows, now),
        sparkline12mo:      bucketBy12Months(revenueRows, now),
      },
      payments: computePaymentStats(payments, invoices, now),
    };
  }
}

function computePaymentStats(payments: Payment[], invoices: Invoice[], now: Date) {
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
    methodMixCents[p.method] = (methodMixCents[p.method] ?? 0) + (p.amount ?? 0);
  }

  const invoiceCustomer = new Map(invoices.map((i) => [i.id, i.customerId ?? ""]));
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
