/**
 * REQ-699 (demo-loop cycle 5, M20) — a quote that bills on a schedule.
 *
 * Pair 2 quoted "4 visitas al mes, $180 al mes" and the payment step had no
 * monthly option; the signature billed a one-time $180 and Field →
 * Subscriptions stayed empty. The payment step now offers a RECURRING term:
 * how often (weekly, every 2 weeks, monthly), what each period bills, and an
 * optional last day. Signing it makes a Field subscription that bills each
 * period (backend/src/field — FieldQuoteSubscriptions).
 *
 * Like every agreement term, it is stored in ENGLISH — the neutral base —
 * and every reader localizes it:
 *
 *   "Monthly · $180/mo"            → es "Mensual · $180/mes"
 *   "Weekly · $45/wk"              → es "Semanal · $45/semana"
 *   "Every 2 weeks · $90/2 wks"    → es "Cada 2 semanas · $90/2 semanas"
 *   "… · until 2027-06-30"         → en "… · until Jun 30, 2027",
 *                                    es "… · hasta el 30 jun 2027"
 *
 * The words live here (like terms-i18n.ts) so the backend, the islands and
 * the Jest suite read one dependency-free source.
 */
import { formatTermDate, termDateIso } from "./format-helpers.ts";

type Lang = "en" | "es";

export type RecurringCadence = "weekly" | "biweekly" | "monthly";

export const RECURRING_CADENCES: readonly RecurringCadence[] = [
  "weekly",
  "biweekly",
  "monthly",
];

/** The terms wizard's payment option for a recurring term. */
export const RECURRING_OPTION_ID = "recurring";

export interface RecurringTerm {
  cadence: RecurringCadence;
  /** what each period bills, INTEGER CENTS (> 0) */
  amountCents: number;
  /** the last day it bills (YYYY-MM-DD); absent = until it is stopped */
  endDate?: string;
}

const WORDS: Record<
  Lang,
  Record<
    RecurringCadence,
    { name: string; per: string; every: string; price: string }
  >
> = {
  en: {
    weekly: {
      name: "Weekly",
      per: "/wk",
      every: "every week",
      price: "a week",
    },
    biweekly: {
      name: "Every 2 weeks",
      per: "/2 wks",
      every: "every 2 weeks",
      price: "every 2 weeks",
    },
    monthly: {
      name: "Monthly",
      per: "/mo",
      every: "every month",
      price: "a month",
    },
  },
  es: {
    weekly: {
      name: "Semanal",
      per: "/semana",
      every: "cada semana",
      price: "a la semana",
    },
    biweekly: {
      name: "Cada 2 semanas",
      per: "/2 semanas",
      every: "cada 2 semanas",
      price: "cada 2 semanas",
    },
    monthly: {
      name: "Mensual",
      per: "/mes",
      every: "cada mes",
      price: "al mes",
    },
  },
};

const UNTIL: Record<Lang, string> = { en: "until", es: "hasta el" };
const BILLED: Record<Lang, string> = { en: "Billed", es: "Se cobra" };
const PER_VISIT: Record<Lang, string> = { en: "per visit", es: "por visita" };

/** The cadence's name — "Monthly" / "Mensual", "Every 2 weeks" / "Cada 2
 *  semanas": the words the term opens with, so the Recurring form's chips
 *  read like the preview and the agreement. */
export function recurringCadenceName(
  cadence: RecurringCadence,
  lang: Lang,
): string {
  return WORDS[lang === "es" ? "es" : "en"][cadence].name;
}

/** "$180", "$180.50", "$1,200" — whole dollars unless there are cents. */
export function recurringMoney(cents: number): string {
  const whole = cents % 100 === 0;
  return `$${
    (cents / 100).toLocaleString("en-US", {
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: 2,
    })
  }`;
}

/** The English base the quote stores: "Monthly · $180/mo · until 2027-06-30". */
export function recurringTermValue(r: RecurringTerm): string {
  const w = WORDS.en[r.cadence];
  const end = r.endDate ? ` · until ${r.endDate}` : "";
  return `${w.name} · ${recurringMoney(r.amountCents)}${w.per}${end}`;
}

/** The term in the reader's language: "Mensual · $180/mes · hasta el 30 jun 2027". */
export function recurringTermText(r: RecurringTerm, lang: Lang): string {
  const l: Lang = lang === "es" ? "es" : "en";
  const w = WORDS[l][r.cadence];
  const end = r.endDate ? ` · ${UNTIL[l]} ${formatTermDate(r.endDate, l)}` : "";
  return `${w.name} · ${recurringMoney(r.amountCents)}${w.per}${end}`;
}

const fold = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ")
    .trim();

/** The cadence a term opens with — the base's words or the Spanish text. */
const CADENCE_HEAD: [RegExp, RecurringCadence][] = [
  [
    /^(?:every (?:2|two|other) weeks?|bi-?weekly|cada (?:2|dos) semanas|quincenal)\b/,
    "biweekly",
  ],
  [/^(?:weekly|every week|semanal|cada semana)\b/, "weekly"],
  [/^(?:monthly|every month|mensual|cada mes)\b/, "monthly"],
];

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
  ene: 1,
  abr: 4,
  ago: 8,
  dic: 12,
};

/** A typed or displayed last day — "2027-06-30", "06/30/2027", "Jun 30,
 *  2027", "30 jun 2027" — as YYYY-MM-DD; null when it is no date. */
function endDateOf(text: string): string | null {
  const s = fold(text).replace(/\.$/, "");
  const iso = termDateIso(s);
  if (iso) return iso;
  const mdy = /^([a-z]{3,4})[a-z]*\.? (\d{1,2}),? (\d{4})$/.exec(s);
  const dmy = /^(\d{1,2}) (?:de )?([a-z]{3,4})[a-z]*\.?,? (?:de )?(\d{4})$/
    .exec(s);
  const [mon, day, year] = mdy
    ? [mdy[1], mdy[2], mdy[3]]
    : dmy
    ? [dmy[2], dmy[1], dmy[3]]
    : [];
  const m = mon ? MONTHS[mon] ?? MONTHS[mon.slice(0, 3)] : undefined;
  if (!m || !day || !year) return null;
  return termDateIso(
    `${year}-${String(m).padStart(2, "0")}-${day.padStart(2, "0")}`,
  );
}

/**
 * The recurring term a stored (or displayed) value states — its cadence
 * first, then a dollar amount above zero, then optionally its last day.
 * Null for every one-off term ("Net 15", "50/50", "Monthly progress
 * payments") and for anything that does not read as a schedule.
 */
export function parseRecurringTerm(
  value: string | null | undefined,
): RecurringTerm | null {
  const s = fold(value ?? "");
  if (!s) return null;
  const head = CADENCE_HEAD.find(([re]) => re.test(s));
  if (!head) return null;
  const rest = s.replace(head[0], "");
  const money =
    /^\s*(?:[·•|,:-]\s*)?\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/
      .exec(rest);
  if (!money) return null;
  const cents = Math.round(
    Number(
      `${money[1].replace(/,/g, "")}.${(money[2] ?? "0").padEnd(2, "0")}`,
    ) *
      100,
  );
  if (!(cents > 0)) return null;
  const tail = rest.slice(money[0].length)
    // the per-period suffix: "/mo", "/2 wks", "/semana", " a month", " al mes"
    .replace(
      /^\s*(?:\/\s*(?:2\s*)?[a-z]+|(?:a|per|al|por|cada|every) (?:(?:2|dos) )?[a-z]+)/,
      "",
    )
    .trim();
  if (!tail) return { cadence: head[1], amountCents: cents };
  const until = /^[·•|,-]?\s*(?:until|through|thru|ends?|hasta(?: el)?)\s+(.+)$/
    .exec(tail);
  const endDate = until ? endDateOf(until[1]) : null;
  if (!endDate) return null;
  return { cadence: head[1], amountCents: cents, endDate };
}

/** A stored value in `lang` when it is a recurring term; null otherwise. */
export function localizeRecurringTerm(
  value: string | null | undefined,
  lang: Lang,
): string | null {
  const r = parseRecurringTerm(value);
  return r ? recurringTermText(r, lang) : null;
}

/** The quote's recurring payment term, if its payment row is one. */
export function recurringFromTerms(
  terms: ReadonlyArray<{ stepId?: string; value?: string }> | null | undefined,
): RecurringTerm | null {
  const row = terms?.find((t) => t?.stepId === "payment_terms");
  return parseRecurringTerm(row?.value);
}

/** The agreement's payment-schedule row: "Monthly — $180.00 — Billed every
 *  month · until Jun 30, 2027". */
export function recurringScheduleRow(
  r: RecurringTerm,
  lang: Lang,
): { label: string; amount: number; when: string } {
  const l: Lang = lang === "es" ? "es" : "en";
  const w = WORDS[l][r.cadence];
  const end = r.endDate ? ` · ${UNTIL[l]} ${formatTermDate(r.endDate, l)}` : "";
  return {
    label: w.name,
    amount: r.amountCents,
    when: `${BILLED[l]} ${w.every}${end}`,
  };
}

/** A price as the assistant says it back: "$180 al mes", "$45 a week",
 *  "$45 per visit" (no cadence stated). */
export function recurringPriceText(
  p: { cadence?: RecurringCadence; amountCents: number },
  lang: Lang,
): string {
  const l: Lang = lang === "es" ? "es" : "en";
  const per = p.cadence ? WORDS[l][p.cadence].price : PER_VISIT[l];
  return `${recurringMoney(p.amountCents)} ${per}`;
}

/** The most a period can bill — Field's own cap on a subscription price. */
export const MAX_PERIOD_CENTS = 10_000_000;

/** REQ-699: the amount the contractor typed in the Recurring form — "180",
 *  "$180.50", "1,200" → cents; null for nothing, zero, a non-number or more
 *  than a period can bill. */
export function recurringAmountCents(typed: string): number | null {
  const s = (typed ?? "").trim().replace(/^\$\s*/, "");
  if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(Number(s.replace(/,/g, "")) * 100);
  return cents > 0 && cents <= MAX_PERIOD_CENTS ? cents : null;
}

const EVERY_KEY: Record<RecurringCadence, string> = {
  weekly: "asstChat.recurring.every.weekly",
  biweekly: "asstChat.recurring.every.biweekly",
  monthly: "asstChat.recurring.every.monthly",
};

/** REQ-699: the i18n KEY of the ask's "{every}" — "every month" / "cada
 *  mes"; with no cadence stated (a per-visit price), "on a schedule". */
export function recurringEveryKey(cadence?: RecurringCadence): string {
  return cadence ? EVERY_KEY[cadence] : "asstChat.recurring.every.schedule";
}
