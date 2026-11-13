/**
 * REQ-795 — the Reports page, pure: which slices exist, the export URL each
 * one downloads, the date presets, and whether a custom range is sane.
 * Raphael: "make it so we can select what slice of data we want and for what
 * dates." The backend (`GET /<kind>/export.csv?from&to`) does the filtering.
 */
import { parseIsoDay } from "../../shared/documents/exports.ts";

export type ReportSliceId =
  | "invoices"
  | "unpaid"
  | "paid"
  | "payments"
  | "quotes"
  | "customers";

export interface ReportSlice {
  id: ReportSliceId;
  /** the API path (the front-end proxies /api → backend) */
  path: string;
  /** the fixed query this slice always carries */
  query?: Record<string, string>;
}

export const REPORT_SLICES: readonly ReportSlice[] = [
  {
    id: "invoices",
    path: "/api/invoices/export.csv",
    query: { status: "all" },
  },
  {
    id: "unpaid",
    path: "/api/invoices/export.csv",
    query: { status: "unpaid" },
  },
  { id: "paid", path: "/api/invoices/export.csv", query: { status: "paid" } },
  { id: "payments", path: "/api/payments/export.csv" },
  { id: "quotes", path: "/api/quotes/export.csv" },
  { id: "customers", path: "/api/customers/export.csv" },
];

export interface DateRange {
  from?: string;
  to?: string;
}

export function reportExportHref(id: ReportSliceId, range: DateRange): string {
  const slice = REPORT_SLICES.find((s) => s.id === id) ?? REPORT_SLICES[0];
  const q = new URLSearchParams(slice.query ?? {});
  if (range.from) q.set("from", range.from);
  if (range.to) q.set("to", range.to);
  const qs = q.toString();
  return qs ? `${slice.path}?${qs}` : slice.path;
}

export const REPORT_PRESETS = [
  "all",
  "thisMonth",
  "lastMonth",
  "thisYear",
  "lastYear",
  "custom",
] as const;
export type ReportPreset = typeof REPORT_PRESETS[number];

const day = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const lastDayOf = (y: number, m: number) =>
  new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** The range a preset means on `now` (UTC days); All time and Custom are open. */
export function presetRange(preset: ReportPreset, now: Date): DateRange {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  switch (preset) {
    case "thisMonth":
      return { from: day(y, m, 1), to: day(y, m, lastDayOf(y, m)) };
    case "lastMonth": {
      const ly = m === 0 ? y - 1 : y;
      const lm = m === 0 ? 11 : m - 1;
      return { from: day(ly, lm, 1), to: day(ly, lm, lastDayOf(ly, lm)) };
    }
    case "thisYear":
      return { from: day(y, 0, 1), to: day(y, 11, 31) };
    case "lastYear":
      return { from: day(y - 1, 0, 1), to: day(y - 1, 11, 31) };
    default:
      return {};
  }
}

/** Both ends are real days (or empty) and From is not after To. */
export function isValidRange(range: DateRange): boolean {
  const from = range.from ? parseIsoDay(range.from) : null;
  const to = range.to ? parseIsoDay(range.to) : null;
  if (range.from && !from) return false;
  if (range.to && !to) return false;
  if (from && to && from > to) return false;
  return true;
}
