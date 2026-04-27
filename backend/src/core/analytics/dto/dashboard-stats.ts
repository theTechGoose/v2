/**
 * The shape returned by `GET /analytics/dashboard`.
 *
 * Drives the dashboard's hero numbers, KPI tiles, sidebar nav badges, and
 * sparkline. One round-trip on dashboard mount.
 *
 * Money fields are in CENTS (integer), not dollars — the frontend formats
 * for display. Eliminates float drift in summation.
 */

export interface QuoteCounts {
  total:    number;
  draft:    number;
  sent:     number;
  accepted: number;
}

export interface ContractCounts {
  total:  number;
  draft:  number;
  signed: number;
}

export interface InvoiceCounts {
  total:   number;
  pending: number;
  paid:    number;
  /** Subset of pending whose dueDate is in the past. */
  overdue: number;
}

export interface RevenueStats {
  /** Sum of paid-invoice amounts year-to-date. */
  ytdCents:        number;
  /** Sum of paid-invoice amounts in the previous calendar month. */
  lastMonthCents:  number;
  /** monthOverMonth percentage change vs the month before lastMonth (positive = growth). */
  monthOverMonthPct: number;
  /** Length-12 array, oldest → newest, of monthly paid-invoice totals (cents). */
  sparkline12mo:   number[];
}

export interface DashboardStats {
  customers: number;
  quotes:    QuoteCounts;
  contracts: ContractCounts;
  invoices:  InvoiceCounts;
  /** Sum of estimatedTotal across quotes whose status === 'sent'. In cents. */
  quotedValueCents:   number;
  /** Number of quotes in 'sent' status (i.e. waiting on the customer). */
  awaitingResponse:   number;
  revenue:            RevenueStats;
}
