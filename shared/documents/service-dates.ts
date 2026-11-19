/**
 * REQ-1064 (LOOP-007 q2-53): an invoice's service window as one string.
 *
 * A one-day job stores serviceDateFrom == serviceDateTo; it reads as that one
 * day, never "Nov 19 → Nov 19". Two different days join with `sep`; when only
 * one end is set, that day alone. Shared by the public page (/i/:id), the
 * invoice email, the invoice PDF and the global search sub-line, so every view
 * of the same invoice spells the same dates the same way.
 *
 * Two ends are the same day when their stored "YYYY-MM-DD" days match (a bare
 * day and a full ISO stamp of it are one day) or when they format the same.
 */

/** The en dash the email and PDF have always used between two days. */
export const SERVICE_DATES_SEP = " – ";

export function fmtServiceDates(
  from: string | undefined | null,
  to: string | undefined | null,
  fmt: (d: string) => string,
  sep: string = SERVICE_DATES_SEP,
): string | undefined {
  const a = from || undefined;
  const b = to || undefined;
  if (!a && !b) return undefined;
  if (!a || !b) return fmt((a ?? b) as string);
  const fa = fmt(a);
  if (a.slice(0, 10) === b.slice(0, 10)) return fa;
  const fb = fmt(b);
  return fa === fb ? fa : `${fa}${sep}${fb}`;
}
