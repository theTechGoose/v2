/**
 * REQ-174 — how many days the customer has to pay, from the day the invoice is
 * sent: the subscription's own number when it has one (the soonest when a
 * customer's batch spans several subscriptions), else the account's default
 * from Settings, else 30. Pure.
 */

export const DEFAULT_NET_DAYS = 30;

export function netDaysFor(
  subscriptionNetDays: (number | undefined)[],
  accountDefault: number | undefined,
): number {
  const own = subscriptionNetDays.filter((n): n is number =>
    typeof n === "number"
  );
  if (own.length) return Math.min(...own);
  return typeof accountDefault === "number" ? accountDefault : DEFAULT_NET_DAYS;
}

/** a whole number of days 0–365; null / "" / undefined clear it */
export function parseNetDays(
  v: unknown,
): { ok: true; value: number | undefined } | { ok: false; reason: string } {
  if (v === undefined || v === null || v === "") {
    return { ok: true, value: undefined };
  }
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 365) {
    return {
      ok: false,
      reason: "netDays must be a whole number of days from 0 to 365",
    };
  }
  return { ok: true, value: n };
}
