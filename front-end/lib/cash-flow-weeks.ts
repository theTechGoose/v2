/**
 * REQ-325 (demo-loop cycle 1, issue m38): the /payments "Cash-flow shape"
 * chart is time-based.
 *
 * Landed payments are bucketed by the ISO week (Monday-start) of their
 * `receivedAt` over the last 12 weeks ending in the current week — bucket
 * 11 is this week, bucket 0 is eleven weeks back; anything older or in the
 * future is outside the window. The three axis labels are the months of the
 * first, middle and last bucket, as `dashboardPage.month.*` keys so the
 * island localises them.
 *
 * Pure and dependency-free so the jest unit project can require it.
 */

export const MONTH_KEYS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

export type MonthKey = (typeof MONTH_KEYS)[number];

export const CASH_FLOW_WEEKS = 12;

const WEEK_MS = 7 * 24 * 3600 * 1000;

export interface CashFlowInput {
  receivedAt: string;
  amount: number;
}

export interface CashFlowWeeks {
  /** Landed cents per ISO week, oldest first; the last entry is this week. */
  weeks: number[];
  /** Month of the first, middle and last bucket (today-11w, today-6w, today). */
  labels: [MonthKey, MonthKey, MonthKey];
}

/** Monday 00:00 (local time) of the ISO week containing `d`. */
export function isoWeekStart(d: Date): Date {
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (start.getDay() + 6) % 7; // Mon=0 … Sun=6
  start.setDate(start.getDate() - dow);
  return start;
}

/** Whole ISO weeks between the week of `then` and the week of `now`. */
function weeksBack(then: Date, now: Date): number {
  return Math.round(
    (isoWeekStart(now).getTime() - isoWeekStart(then).getTime()) / WEEK_MS,
  );
}

export function cashFlowWeeks(
  payments: readonly CashFlowInput[],
  now: Date = new Date(),
): CashFlowWeeks {
  const weeks: number[] = new Array(CASH_FLOW_WEEKS).fill(0);
  for (const p of payments) {
    const received = new Date(p.receivedAt);
    if (Number.isNaN(received.getTime())) continue;
    const back = weeksBack(received, now);
    if (back < 0 || back >= CASH_FLOW_WEEKS) continue;
    weeks[CASH_FLOW_WEEKS - 1 - back] += p.amount;
  }
  const monthAt = (weeksAgo: number): MonthKey => {
    const d = new Date(now.getTime() - weeksAgo * WEEK_MS);
    return MONTH_KEYS[d.getMonth()];
  };
  return {
    weeks,
    labels: [
      monthAt(CASH_FLOW_WEEKS - 1),
      monthAt(Math.floor(CASH_FLOW_WEEKS / 2)),
      monthAt(0),
    ],
  };
}
