/**
 * REQ-411 (demo-loop cycle 2, m34 + m35) — when a pay-on-completion job is
 * done, and how long the customer then has to pay.
 *
 * The terms wizard stores the start ("Next week") and the duration ("4
 * weeks") as TERMS, not ISO dates — the stored English base for a preset, the
 * contractor's (possibly localized) text for a custom value. The bill for
 * "Payment upon completion" is scheduled for the job's end: start + duration.
 *
 * The days to pay are the account's one setting (Settings → "Days to pay an
 * invoice", REQ-174); unset, every surface uses the 30 that field shows.
 *
 * Dependency-light: imported by the backend (#quote-flow/), the front-end
 * islands and the Jest unit suite.
 */
import { extractDuration } from "./quote-facts.ts";

/** The days to pay when the account never set its own (what Settings shows). */
export const DEFAULT_INVOICE_NET_DAYS = 30;

/** The account's days to pay: its Settings number, else the default. */
export function accountNetDays(n: number | null | undefined): number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0
    ? n
    : DEFAULT_INVOICE_NET_DAYS;
}

const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const fold = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();

const utcDay = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

function addUtcDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

function addUtcMonths(d: Date, months: number): Date {
  const next = new Date(d.getTime());
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

/** The day a start term means, relative to `today` (UTC midnight). Undefined
 *  for TBD or anything that is not a date. */
export function startFromTerm(
  value: string | undefined,
  today: Date,
): Date | undefined {
  const v = fold(value ?? "");
  if (!v) return undefined;
  const base = utcDay(today);
  if (ISO_DAY.test(v)) {
    const d = new Date(`${v}T00:00:00Z`);
    return Number.isFinite(d.getTime()) ? d : undefined;
  }
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (us) {
    const d = new Date(Date.UTC(+us[3], +us[1] - 1, +us[2]));
    return d.getUTCMonth() === +us[1] - 1 ? d : undefined;
  }
  if (
    /^(?:right away|asap|now|today|de inmediato|inmediatamente|hoy)$/.test(v)
  ) {
    return base;
  }
  if (/^(?:next week|la proxima semana|proxima semana)$/.test(v)) {
    return addUtcDays(base, 7);
  }
  if (/^(?:next month|el proximo mes|proximo mes)$/.test(v)) {
    return addUtcMonths(base, 1);
  }
  return undefined;
}

/** A duration term's length; a range ("2–3 days") counts its upper bound.
 *  Hours finish the day they start. Undefined for TBD / no duration. */
function addDuration(start: Date, value: string | undefined): Date | undefined {
  const text = (value ?? "").trim();
  if (!text) return undefined;
  const range = /(\d{1,2})\s*[-–]\s*(\d{1,2})\s*(\p{L}+)/u.exec(text);
  const parsed = extractDuration(range ? `${range[2]} ${range[3]}` : text);
  if (!parsed) return undefined;
  const { n, unit } = parsed;
  switch (unit) {
    case "hours":
      return addUtcDays(start, Math.floor(n / 24));
    case "days":
      return addUtcDays(start, Math.ceil(n));
    case "weeks":
      return addUtcDays(start, Math.ceil(n * 7));
    case "months":
      return addUtcMonths(start, Math.ceil(n));
  }
}

type TermsInput = {
  terms?: ReadonlyArray<{ stepId: string; value: string }> | null;
  startDate?: string;
  today: Date;
};

const termOf = (input: TermsInput, id: string) =>
  input.terms?.find((t) => t.stepId === id)?.value;

function startOf(input: TermsInput): Date {
  const base = utcDay(input.today);
  const stated = input.startDate && ISO_DAY.test(input.startDate)
    ? new Date(`${input.startDate}T00:00:00Z`)
    : startFromTerm(termOf(input, "start_date"), input.today);
  return stated && stated.getTime() > base.getTime() ? stated : base;
}

/** The day the job starts (ISO): the quote's ISO `startDate`, else the start
 *  term, else today — never before today. */
export function startDayFromTerms(input: TermsInput): string {
  return startOf(input).toISOString().slice(0, 10);
}

/** The job's end (ISO day): its start (startDayFromTerms) plus the duration
 *  term. Undefined when there is no duration to add (none, or TBD). */
export function completionFromTerms(input: TermsInput): string | undefined {
  const end = addDuration(
    startOf(input),
    termOf(input, "wraps") ?? termOf(input, "time_to_complete"),
  );
  return end ? end.toISOString().slice(0, 10) : undefined;
}
