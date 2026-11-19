/**
 * REQ-944 — the app header's date ("Miércoles · 18 de noviembre"): today in
 * the BUSINESS's time zone (GET /me `businessTimezone`, REQ-255 resolution),
 * never the server process's zone — SSR runs in UTC on Deno Deploy, so an
 * evening in Texas used to read as tomorrow. One helper for the seven app
 * routes that used to each build it from `new Date().getDay()/getMonth()`.
 */
import { type Lang, tFor } from "./i18n.ts";

const WEEKDAY_KEYS = [
  "date.weekday.sunday",
  "date.weekday.monday",
  "date.weekday.tuesday",
  "date.weekday.wednesday",
  "date.weekday.thursday",
  "date.weekday.friday",
  "date.weekday.saturday",
];
const MONTH_KEYS = [
  "date.month.january",
  "date.month.february",
  "date.month.march",
  "date.month.april",
  "date.month.may",
  "date.month.june",
  "date.month.july",
  "date.month.august",
  "date.month.september",
  "date.month.october",
  "date.month.november",
  "date.month.december",
];
const DEFAULT_ZONE = "America/New_York";

/** { weekday 0-6, month 0-11, day } of `at` in `timeZone` */
export function zonedDay(
  at: Date,
  timeZone: string | undefined,
): { weekday: number; month: number; day: number } {
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).formatToParts(at);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = fmt(timeZone || DEFAULT_ZONE);
  } catch {
    parts = fmt(DEFAULT_ZONE);
  }
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const year = get("year"), month = get("month") - 1, day = get("day");
  // the weekday of that calendar date, computed zone-free
  const weekday = new Date(Date.UTC(year, month, day)).getUTCDay();
  return { weekday, month, day };
}

/** "Wednesday · November 18" / "Miércoles · noviembre 18" in the business's zone */
export function greetingDate(
  lang: Lang,
  timeZone: string | undefined,
  at: Date = new Date(),
): string {
  const { weekday, month, day } = zonedDay(at, timeZone);
  return `${tFor(lang, WEEKDAY_KEYS[weekday])} · ${
    tFor(lang, MONTH_KEYS[month])
  } ${day}`;
}
