/**
 * REQ-081/090/102/108 — the demo booking on /landing2, the part both sides agree on: the times
 * the page offers (REQ-108: 8 AM to 8 PM Eastern, every half hour, a specific time — the two
 * windows are gone), the days it offers (REQ-102: every day the backend accepts, DEMO_DAY_WINDOW
 * of them from tomorrow, Eastern — never today, REQ-108 — shown DEMO_DAY_COUNT at a time between
 * two arrows), how a day and a time are labelled in each language, and the words for a
 * call booked with just a cell ("as soon as possible"). The page's island renders from this; the
 * backend (demo-request) validates — the same window — and writes the confirmation from the same
 * source. Pure data and date arithmetic, no imports.
 */

export type DemoLang = "es" | "en";
/**
 * REQ-108 — Raphael, 2026-10-21: "Visitors must select a specific day and time, rather than a
 * morning or afternoon window. Offer available times between 8 a.m. and 8 p.m. Eastern Time."
 * A demo starts on a half hour from 8:00 AM, the last start half an hour before the 8 PM close —
 * twenty-four times, Eastern. `id` is the 24-hour HH:MM the page posts and the backend checks;
 * `label` is what the person reads.
 */
export const DEMO_OPEN_HOUR = 8;
export const DEMO_CLOSE_HOUR = 20;
export const DEMO_STEP_MINUTES = 30;

export interface DemoTime {
  /** HH:MM, 24-hour, Eastern */
  id: string;
  /** "8:00 AM" */
  label: string;
}

function timeLabel(hour: number, minute: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

export const DEMO_TIMES: readonly DemoTime[] = (() => {
  const out: DemoTime[] = [];
  for (let m = DEMO_OPEN_HOUR * 60; m < DEMO_CLOSE_HOUR * 60; m += DEMO_STEP_MINUTES) {
    const hour = Math.floor(m / 60);
    const minute = m % 60;
    out.push({ id: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`, label: timeLabel(hour, minute) });
  }
  return out;
})();

/** the time zone every time is in, as the page says it */
export const DEMO_TZ: Record<DemoLang, string> = {
  es: "hora del Este",
  en: "Eastern",
};

/** the number of days the picker shows at a time — a page; the arrows slide it by this many (REQ-102) */
export const DEMO_DAY_COUNT = 5;

/**
 * REQ-102 — how many days out a demo can be booked: the days the page offers (from tomorrow,
 * Eastern) and the window the backend accepts (from today, UTC — never behind Eastern, so every
 * day offered is taken). A whole number of pages.
 */
export const DEMO_DAY_WINDOW = 90;

export function demoTime(id: string): DemoTime | undefined {
  return DEMO_TIMES.find((t) => t.id === id);
}

/** one time as the summary and the messages read it: "10:30 AM (hora del Este)" */
export function demoTimeLabel(id: string, lang: DemoLang): string {
  return `${demoTime(id)?.label ?? id} (${DEMO_TZ[lang]})`;
}

/** REQ-108 — the earliest day a demo can be booked: tomorrow, Eastern — never today */
export function demoEarliestDay(now: Date = new Date()): string {
  const today = demoDateOf(easternToday(now)) ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return new Date(today.getTime() + 86_400_000).toISOString().slice(0, 10);
}

const DOWS: Record<DemoLang, string[]> = {
  es: ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
};
const MONS: Record<DemoLang, string[]> = {
  es: [
    "Ene",
    "Feb",
    "Mar",
    "Abr",
    "May",
    "Jun",
    "Jul",
    "Ago",
    "Sep",
    "Oct",
    "Nov",
    "Dic",
  ],
  en: [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ],
};

/** the date-only midnight (UTC) of a YYYY-MM-DD; null when it is not a real date */
export function demoDateOf(day: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (
    date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 ||
    date.getUTCDate() !== d
  ) return null;
  return date;
}

export interface DemoDay {
  /** YYYY-MM-DD */
  iso: string;
  dow: string;
  num: string;
  mon: string;
}

/** one day as the summary shows it: "Sáb 17 Oct" */
export function demoDayLabel(day: string, lang: DemoLang): string {
  const d = demoDay(day, lang);
  return d ? `${d.dow} ${d.num} ${d.mon}` : day;
}

export function demoDay(day: string, lang: DemoLang): DemoDay | null {
  const date = demoDateOf(day);
  if (!date) return null;
  return {
    iso: day,
    dow: DOWS[lang][date.getUTCDay()],
    num: String(date.getUTCDate()),
    mon: MONS[lang][date.getUTCMonth()],
  };
}

/** today's date in the Eastern time zone, as YYYY-MM-DD */
export function easternToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** the month, or the two months, the days on view fall in: "Oct", "Oct – Nov" (REQ-102) */
export function demoMonthRange(days: readonly DemoDay[]): string {
  return [...new Set(days.map((d) => d.mon))].join(" – ");
}

/** every day the page offers — DEMO_DAY_WINDOW of them, consecutive, starting tomorrow (Eastern) */
export function upcomingDemoDays(
  lang: DemoLang,
  now: Date = new Date(),
): DemoDay[] {
  const base = demoDateOf(easternToday(now)) ??
    new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
  const out: DemoDay[] = [];
  for (let i = 1; i <= DEMO_DAY_WINDOW; i++) {
    const d = new Date(base.getTime() + i * 86_400_000);
    const iso = d.toISOString().slice(0, 10);
    out.push(demoDay(iso, lang) as DemoDay);
  }
  return out;
}
