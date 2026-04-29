import { Injectable } from "#danet/core";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { ContractStore } from "@paperwork/domain/data/contract-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import {
  bucketBy12Months,
  lastMonthRevenue,
  monthOverMonthPct,
  type RevenueRow,
  ytdRevenue,
} from "@core/business/sparkline/mod.ts";
import type { DashboardStats } from "@analytics/dto/dashboard-stats.ts";

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
  ) {}

  async run(userId: string, now: Date = new Date()): Promise<DashboardStats> {
    // Five parallel listByUser scans. Each is in-memory after the KV index
    // hit, so they're cheap. If we add 1000-customer accounts this becomes
    // the place to introduce per-resource counters.
    const [customers, quotes, contracts, invoices] = await Promise.all([
      this.customers.listByUser(userId),
      this.quotes.listByUser(userId),
      this.contracts.listByUser(userId),
      this.invoices.listByUser(userId),
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
      total:   invoices.length,
      pending: invoices.filter((i) => i.status === "pending").length,
      paid:    invoices.filter((i) => i.status === "paid").length,
      overdue: invoices.filter((i) => i.status === "pending" && i.dueDate < todayIso).length,
    };

    // Quoted value: sum of estimatedTotal across quotes that are still
    // open (sent but not accepted/declined). estimatedTotal is in DOLLARS
    // in the DTO; multiply for cents.
    const quotedValueCents = Math.trunc(
      quotes
        .filter((q) => q.status === "sent")
        .reduce((sum, q) => sum + (q.estimatedTotal ?? 0), 0) * 100,
    );

    // Revenue rows: each paid invoice contributes amount → revenue.
    // Invoice.amount is dollars too.
    const revenueRows: RevenueRow[] = invoices
      .filter((i) => i.status === "paid" && i.paidAt)
      .map((i) => ({
        paidAt: i.paidAt!,
        amountCents: Math.trunc((i.amount ?? 0) * 100),
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
    };
  }
}
