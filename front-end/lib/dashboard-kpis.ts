import type { DashboardStats } from "../clients/dashboard.ts";

/** The dashboard's KPI numbers, read from `GET /analytics/dashboard`. */
export function pickKpis(stats: DashboardStats | undefined) {
  const buckets = stats?.invoices.agingBuckets;
  const current = (buckets?.current ?? 0) / 100;
  const mid = (buckets?.aging1_14d ?? 0) / 100;
  const overdue =
    ((buckets?.overdue15_30d ?? 0) + (buckets?.overdue30plus ?? 0)) / 100;
  const owed = current + mid + overdue;
  const sparkline = stats?.revenue.sparkline12mo ?? [];
  const thisMonthBilled =
    (sparkline.length > 0 ? sparkline[sparkline.length - 1] : 0) / 100;

  // REQ-562 (demo-loop cycle 4, m21): average over distinct paid JOBS — a
  // 50/50 job paid in two installments is one job, not two.
  const paidJobs = stats?.revenue.paidJobsYtd ?? stats?.invoices.paid ?? 0;
  const ytd = (stats?.revenue.ytdCents ?? 0) / 100;
  const avgJob = paidJobs > 0 ? Math.round(ytd / paidJobs) : 0;

  // REQ-397 (demo-loop cycle 2, M14): the buckets are the open receivables'
  // balances in CENTS, so Outstanding is exactly what they add up to. The old
  // "pending === 0 → $0" clamp hid buckets that counted invoices (+1 each)
  // and a count that read a status accept never writes.
  const pending = stats?.invoices.pending ?? 0;

  return {
    thisMonthBilled,
    activeJobs: 0,
    outstanding: owed,
    outstandingCount: pending,
    outstandingOverdue: stats?.invoices.overdue ?? 0,
    pendingQuotes: stats?.quotes.sent ?? 0,
    // INTEGER CENTS end to end (P-36) — the KPI formats via
    // formatMoneyCompact, so no /100 dollars conversion here.
    pendingTotal: stats?.quotedValueCents ?? 0,
    avgJob,
    owed,
    current,
    mid,
    overdue,
  };
}
