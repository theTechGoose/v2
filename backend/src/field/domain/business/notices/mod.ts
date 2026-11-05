/**
 * REQ-171/172 — the field texts (a worker's new job today, a customer's canceled or deferred
 * service, the 9 am "you're on today's schedule") and the once-a-day rule in the business's
 * time zone. Pure.
 */
import { type Lang, t } from "@core/i18n/mod.ts";
import {
  DEFAULT_TIMEZONE,
  validTimezone,
} from "@users/domain/business/timezone/mod.ts";

export { DEFAULT_TIMEZONE, validTimezone };

export type NoticeLang = Lang;

/** "Nov 7" / "7 nov" */
export function shortDate(iso: string, lang: NoticeLang): string {
  return new Intl.DateTimeFormat(lang === "es" ? "es" : "en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
    .format(new Date(iso + "T12:00:00Z")).replace(/\.$/, "");
}

export function workerNewTaskText(
  lang: NoticeLang,
  v: { owner: string; type: string; customer: string; address: string },
): string {
  return t(lang, "field.sms.workerNewTask", v);
}

export function customerTodayText(
  lang: NoticeLang,
  v: { business: string; services: string },
): string {
  return t(lang, "field.sms.customerToday", v);
}

export function customerCanceledText(
  lang: NoticeLang,
  v: { business: string; service: string; date: string },
): string {
  return t(lang, "field.sms.customerCanceled", {
    ...v,
    date: shortDate(v.date, lang),
  });
}

export function customerDeferredText(
  lang: NoticeLang,
  v: { business: string; service: string; from: string; to: string },
): string {
  return t(lang, "field.sms.customerDeferred", {
    ...v,
    from: shortDate(v.from, lang),
    to: shortDate(v.to, lang),
  });
}

/** the services of a visit, each once, in order */
export const servicesLine = (names: string[]) => [...new Set(names)].join(", ");

/** the local calendar date and clock in a zone */
export function localClock(
  tz: string,
  now: Date,
): { date: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(now);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

export const SCHEDULE_HOUR = 9;

/** the local date to send the schedule text for — once the clock reads 09:00 or later and that date was not sent yet; else null */
export function scheduleDue(
  input: { tz: string; now: Date; sentForDate?: string },
): string | null {
  const { date, hour } = localClock(
    validTimezone(input.tz) ?? DEFAULT_TIMEZONE,
    input.now,
  );
  if (hour < SCHEDULE_HOUR) return null;
  if (input.sentForDate === date) return null;
  return date;
}
