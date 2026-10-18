/**
 * REQ-081 — the demo booking on /landing2, the part both sides agree on: the twelve hours the
 * page offers, the seven days it shows (from tomorrow, Eastern), and how a day is labelled in
 * each language. The page's island renders from this; the backend (demo-request) validates and
 * writes the confirmation from the same source. Pure data and date arithmetic, no imports.
 */

export type DemoLang = "es" | "en";

/** the twelve hours the page offers, Eastern */
export const DEMO_SLOTS: readonly string[] = [
  "9:00 AM",
  "10:00 AM",
  "11:00 AM",
  "12:00 PM",
  "1:00 PM",
  "2:00 PM",
  "3:00 PM",
  "4:00 PM",
  "5:00 PM",
  "6:00 PM",
  "7:00 PM",
  "8:00 PM",
];

/** the slot the page starts on (11:00 AM) and the number of days it shows */
export const DEFAULT_SLOT_INDEX = 2;
export const DEMO_DAY_COUNT = 7;

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

/** one day as the picker shows it: "Sáb 17 Oct" */
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

/** the seven days the page offers, starting tomorrow (Eastern) */
export function upcomingDemoDays(
  lang: DemoLang,
  now: Date = new Date(),
): DemoDay[] {
  const base = demoDateOf(easternToday(now)) ??
    new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
  const out: DemoDay[] = [];
  for (let i = 1; i <= DEMO_DAY_COUNT; i++) {
    const d = new Date(base.getTime() + i * 86_400_000);
    const iso = d.toISOString().slice(0, 10);
    out.push(demoDay(iso, lang) as DemoDay);
  }
  return out;
}
