/**
 * REQ-943 (LOOP-007 cycle 1, q1-9) — the /payments day rules, pure.
 *
 * The page used to clamp "days ago" at 0 (a payment dated next June read
 * "Today"), bound "this month" only below (next June counted as this month)
 * and average every landed payment into "days to pay" (194d), while the
 * cash-flow card (cashFlowWeeks) dropped the same payment — the hero, the
 * rows and the chart disagreed. Here a payment dated after today is never
 * today, never this month and never in the average, the same rule the
 * cash-flow card already used.
 */

const DAY_MS = 24 * 3600 * 1000;

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** whole local calendar days from `receivedAt` to `now`: 0 today, 1
 *  yesterday, NEGATIVE for a day after today (never clamped). NaN when the
 *  instant does not parse. */
export function calendarDaysAgo(receivedAt: string, now: Date): number {
  const t = new Date(receivedAt);
  if (!Number.isFinite(t.getTime())) return Number.NaN;
  // round, not floor: a DST day is 23 or 25 hours long
  return Math.round(
    (startOfLocalDay(now).getTime() - startOfLocalDay(t).getTime()) / DAY_MS,
  );
}

/** true when `receivedAt` is this local month AND no later than today */
export function isThisMonthSoFar(receivedAt: string, now: Date): boolean {
  const t = new Date(receivedAt).getTime();
  if (!Number.isFinite(t)) return false;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const tomorrow = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
  )
    .getTime();
  // a same-day payment at noon is after "now" at 9 am — still today
  return t >= monthStart && t < tomorrow;
}

/** whole days from the invoice's issue day to the payment; null when either
 *  date is missing/unparseable or the payment is dated after today */
export function daysToPayOf(
  receivedAt: string,
  issuedDate: string | null | undefined,
  now: Date,
): number | null {
  if (!issuedDate) return null;
  const issued = new Date(issuedDate).getTime();
  const received = new Date(receivedAt).getTime();
  if (!Number.isFinite(issued) || !Number.isFinite(received)) return null;
  if (calendarDaysAgo(receivedAt, now) < 0) return null;
  return Math.max(0, Math.floor((received - issued) / DAY_MS));
}
