/**
 * Pure helpers for shaping monthly revenue series + month-over-month
 * comparisons. Operates on `{ ts: ISOstring, amountCents: number }` rows
 * — what the analytics coordinator extracts from the invoice store.
 */

export interface RevenueRow {
  /** Date the invoice was *paid*. */
  paidAt: string;
  /** Invoice amount in cents (must be ≥0). */
  amountCents: number;
}

/**
 * Bucket a list of paid-invoice rows into the last 12 calendar months
 * (inclusive of `now`'s month), oldest → newest. Months with no revenue
 * appear as 0 — never undefined — so the sparkline always has 12 points.
 */
export function bucketBy12Months(rows: RevenueRow[], now: Date = new Date()): number[] {
  const buckets = new Array(12).fill(0) as number[];
  // The newest bucket is the current month; index 11.
  const baseYear  = now.getUTCFullYear();
  const baseMonth = now.getUTCMonth();              // 0–11
  for (const r of rows) {
    const d = new Date(r.paidAt);
    if (Number.isNaN(d.getTime())) continue;
    const yr  = d.getUTCFullYear();
    const mo  = d.getUTCMonth();
    const monthsAgo = (baseYear - yr) * 12 + (baseMonth - mo);
    if (monthsAgo < 0 || monthsAgo > 11) continue;
    const idx = 11 - monthsAgo;
    buckets[idx] += Math.max(0, Math.trunc(r.amountCents));
  }
  return buckets;
}

/**
 * YTD sum — invoices paid in the current calendar year.
 */
export function ytdRevenue(rows: RevenueRow[], now: Date = new Date()): number {
  const yr = now.getUTCFullYear();
  let total = 0;
  for (const r of rows) {
    const d = new Date(r.paidAt);
    if (Number.isNaN(d.getTime())) continue;
    if (d.getUTCFullYear() === yr) total += Math.max(0, Math.trunc(r.amountCents));
  }
  return total;
}

/**
 * Sum of revenue in the calendar month immediately preceding `now`.
 * If `now` is in February, this returns January's total.
 */
export function lastMonthRevenue(rows: RevenueRow[], now: Date = new Date()): number {
  const buckets = bucketBy12Months(rows, now);
  // Index 11 = current month, 10 = previous month.
  return buckets[10];
}

/**
 * Percentage change between the previous calendar month and the one
 * before it. Returns 0 when the prior-prior month had zero revenue
 * (avoid /0; a "growth from zero" number isn't meaningful).
 */
export function monthOverMonthPct(rows: RevenueRow[], now: Date = new Date()): number {
  const buckets = bucketBy12Months(rows, now);
  const prev    = buckets[10];
  const prior   = buckets[9];
  if (prior === 0) return 0;
  return Math.round(((prev - prior) / prior) * 100);
}
