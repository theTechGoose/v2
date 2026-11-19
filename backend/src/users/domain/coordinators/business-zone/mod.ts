/**
 * REQ-940 (q1-11) — the ONE zone an account's field day, worker action window and timeclock week
 * run on: the business's own Time zone (REQ-172) → its address's state (REQ-255) → the server's
 * FIELD_TZ → New York. The field's "today" used to be FIELD_TZ alone, so a business west (or east)
 * of New York saw a "Today" the server then refused with a 409.
 */
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { BusinessAddressStore } from "@profile/domain/data/business-address-store/mod.ts";
import {
  DEFAULT_TIMEZONE,
  timezoneForState,
  validTimezone,
} from "@users/domain/business/timezone/mod.ts";

/** pure: picked → state → FIELD_TZ → New York */
export function resolveBusinessZone(
  input: { timezone?: unknown; state?: unknown; fallback?: unknown },
): string {
  return validTimezone(input.timezone) ?? timezoneForState(input.state) ??
    validTimezone(input.fallback) ?? DEFAULT_TIMEZONE;
}

const identities = new BusinessIdentityStore();
const addresses = new BusinessAddressStore();

/** the account's zone, read from its identity + address */
export async function businessZoneOf(userId: string): Promise<string> {
  const [identity, address] = await Promise.all([
    identities.get(userId).catch(() => null),
    addresses.get(userId).catch(() => null),
  ]);
  return resolveBusinessZone({
    timezone: identity?.timezone,
    state: address?.state,
    fallback: Deno.env.get("FIELD_TZ"),
  });
}

/** `YYYY-MM-DD` in `tz` at `now` */
export function dayIn(tz: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** REQ-940: the account's field day — "today" in the business's zone */
export async function fieldTodayFor(
  userId: string,
  now: Date = new Date(),
): Promise<string> {
  return dayIn(await businessZoneOf(userId), now);
}
