/** REQ-172 — the business's IANA time zone: validated by Intl, New York when unset. Pure. */
export const DEFAULT_TIMEZONE = "America/New_York";

/** an IANA zone Intl knows, else undefined */
export function validTimezone(tz: unknown): string | undefined {
  if (typeof tz !== "string" || !tz.trim()) return undefined;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz.trim() });
    return tz.trim();
  } catch {
    return undefined;
  }
}
