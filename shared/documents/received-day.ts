/**
 * REQ-943 (LOOP-007 cycle 1, q1-8) — a payment can't be received after
 * today. One rule for the "Payment received" form and for POST/PUT
 * /payments:
 *
 *  - the form compares the picked YYYY-MM-DD with the browser's local day
 *    (`isAfterLocalToday`) — the contractor's own calendar;
 *  - the server only sees an instant and does not know the contractor's zone
 *    for certain, so it allows a day of slack (`RECEIVED_AT_SLACK_MS`): the
 *    form sends noon local, which is at most ~14 hours ahead of the server's
 *    clock anywhere on Earth. A day further out is a typo, not a payment.
 *  - an instant that does not parse is refused too (it used to be stored as
 *    "not a date").
 */

/** how far past the server's clock a received instant may be */
export const RECEIVED_AT_SLACK_MS = 24 * 60 * 60 * 1000;

export type ReceivedAtProblem = "invalid_date" | "future_date";

/** null when `receivedAt` is a real instant no later than now + the slack */
export function receivedAtProblem(
  receivedAt: unknown,
  now: Date = new Date(),
): ReceivedAtProblem | null {
  if (typeof receivedAt !== "string" || !receivedAt.trim()) {
    return "invalid_date";
  }
  const t = new Date(receivedAt).getTime();
  if (!Number.isFinite(t)) return "invalid_date";
  if (t > now.getTime() + RECEIVED_AT_SLACK_MS) return "future_date";
  return null;
}

/** the local calendar day of `d` as YYYY-MM-DD */
export function localIsoDay(d: Date = new Date()): string {
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** true when the YYYY-MM-DD `day` is later than today's local day */
export function isAfterLocalToday(
  day: string,
  now: Date = new Date(),
): boolean {
  return day > localIsoDay(now);
}
