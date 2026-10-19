/**
 * REQ-081/090 — the demo booking on /landing2, the part both sides agree on: the two windows the
 * page offers (morning, afternoon — Eastern), the five days it shows (from tomorrow, Eastern), how
 * a day and a window are labelled in each language, and the words for a call booked with just a
 * cell ("as soon as possible"). The page's island renders from this; the backend (demo-request)
 * validates and writes the confirmation from the same source. Pure data and date arithmetic, no
 * imports.
 */

export type DemoLang = "es" | "en";
export type DemoSlotId = "morning" | "afternoon";

export interface DemoSlot {
  id: DemoSlotId;
  /** on the button: "Mañana (9–12)" */
  short: Record<DemoLang, string>;
  /** in the summary and the messages, before the time zone: "Mañana, 9 AM – 12 PM" */
  long: Record<DemoLang, string>;
}

/** the two windows the page offers, Eastern */
export const DEMO_SLOTS: readonly DemoSlot[] = [
  {
    id: "morning",
    short: { es: "Mañana (9–12)", en: "Morning (9–12)" },
    long: { es: "Mañana, 9 AM – 12 PM", en: "Morning, 9 AM – 12 PM" },
  },
  {
    id: "afternoon",
    short: { es: "Tarde (1–5)", en: "Afternoon (1–5)" },
    long: { es: "Tarde, 1 – 5 PM", en: "Afternoon, 1 – 5 PM" },
  },
];

/** the time zone every window is in, as the page says it */
export const DEMO_TZ: Record<DemoLang, string> = {
  es: "hora del Este",
  en: "Eastern",
};

/** a call booked with just a cell: no day, no window */
export const ASAP_LABEL: Record<DemoLang, string> = {
  es: "lo antes posible",
  en: "as soon as possible",
};

/** the number of days the page shows */
export const DEMO_DAY_COUNT = 5;

export function demoSlot(id: string): DemoSlot | undefined {
  return DEMO_SLOTS.find((s) => s.id === id);
}

/** one window as the summary and the messages read it: "Mañana, 9 AM – 12 PM (hora del Este)" */
export function demoSlotLabel(id: string, lang: DemoLang): string {
  const slot = demoSlot(id);
  return slot ? `${slot.long[lang]} (${DEMO_TZ[lang]})` : id;
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

/** the five days the page offers, starting tomorrow (Eastern) */
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
