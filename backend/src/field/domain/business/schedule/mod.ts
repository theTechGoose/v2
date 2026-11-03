/**
 * REQ-139 — a subscription's schedule: weekdays every N weeks from a start
 * date, or monthly on the start date's day. REQ-141 — the company's day.
 * Pure.
 */
import type { Subscription } from "@field/dto/field.ts";

/** a real calendar date, `YYYY-MM-DD` */
export const isValidDate = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z")) &&
  new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;

const dayNum = (iso: string) => Math.round(Date.parse(iso + "T00:00:00Z") / 86_400_000);
export const weekday = (iso: string) => new Date(iso + "T00:00:00Z").getUTCDay();
/** Monday-based week number, so "every 2 weeks" means the same weeks for every weekday. */
const weekNum = (iso: string) => Math.floor((dayNum(iso) - ((weekday(iso) + 6) % 7)) / 7);

export const startOf = (s: Subscription) => (s.startDate ?? s.createdAt).slice(0, 10);
export const intervalOf = (s: Subscription) => s.intervalWeeks ?? (s.cadence === "biweekly" ? 2 : 1);
export const daysOf = (s: Subscription) => (s.days && s.days.length ? s.days : [weekday(startOf(s))]);

/** is this subscription due on this day? */
export function isDue(s: Subscription, date: string): boolean {
  const start = startOf(s);
  if (!isValidDate(start) || date < start) return false;
  if (s.cadence === "monthly") {
    const wanted = Number(start.slice(8)), day = Number(date.slice(8));
    const lastOfMonth = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).getUTCDate();
    return day === Math.min(wanted, lastOfMonth);
  }
  if (!daysOf(s).includes(weekday(date))) return false;
  return (weekNum(date) - weekNum(start)) % intervalOf(s) === 0;
}

const DAY_ABBR = { es: ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"], en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] };

/** the schedule in words — "Cada semana · lun, jue", "Every 3 weeks · Tue", "Mensual · día 5" */
export function scheduleText(s: Subscription, lang: "es" | "en" = "es"): string {
  const start = startOf(s);
  if (s.cadence === "monthly") return lang === "es" ? `Mensual · día ${Number(start.slice(8))}` : `Monthly · day ${Number(start.slice(8))}`;
  const n = intervalOf(s), days = daysOf(s).map((d) => DAY_ABBR[lang][d]).join(", ");
  const every = lang === "es" ? (n === 1 ? "Cada semana" : `Cada ${n} semanas`) : (n === 1 ? "Every week" : `Every ${n} weeks`);
  return `${every} · ${days}`;
}

/** `YYYY-MM-DD` shifted by whole days */
export function shiftDate(iso: string, days: number): string {
  return new Date(Date.parse(iso + "T00:00:00Z") + days * 86_400_000).toISOString().slice(0, 10);
}

/** REQ-141: the company's day in its time zone (FIELD_TZ, default New York), not the UTC day */
export function todayIn(tz: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export const fieldToday = () => todayIn(Deno.env.get("FIELD_TZ")?.trim() || "America/New_York");
