/**
 * REQ-265 (demo issue ai-assistant-m1) — the facts a contractor already typed
 * about a job ("Quote for Maria Lopez 512-555-0199, start Dec 1, half
 * deposit"), pulled out deterministically so the terms wizard pre-fills /
 * pre-selects them instead of asking again.
 *
 * The source text is whatever the user typed for THIS job — the quote's
 * description (the starter-chip flow stores the raw sentence there) and the
 * thread's own user messages (the free-chat flow). Both are persisted, so the
 * facts survive a reload with no extra storage.
 *
 * Pure logic, no side effects. Nothing is invented: a fact the text does not
 * state is null, and every pre-selection stays a confirmable suggestion.
 */
import { extractCustomerName } from "./quick-quote-prefill.ts";
import { type DurationUnit, termLabel } from "./terms-i18n.ts";

/** REQ-387 (demo M25): a schedule the text states that is not a preset —
 *  "30% deposit, 40% at cabinets install, 30% at completion". `milestones`
 *  holds each payment's words as typed ("at cabinets install"), null when
 *  the text gave none. */
export interface CustomPaymentSchedule {
  kind: "custom";
  splits: number[];
  milestones: (string | null)[];
}

export type PrefillPaymentTerms =
  | "50_50"
  | "30_30_40"
  | "deposit_bal"
  | "net_15"
  | CustomPaymentSchedule;

/** The typed START date — `iso` YYYY-MM-DD (the value the wizard's date
 *  picker submits and the term stores, REQ-495), `us` MM/DD/YYYY. */
export interface StartDateFact {
  iso: string;
  us: string;
  /** REQ-575 (demo-loop cycle 4, M3): "next week" / "la próxima semana",
   *  "next month", "right away" — the wizard's own option for it (`iso` is
   *  the day it means), never a made-up date. */
  preset?: "asap" | "next_week" | "next_month";
  /** REQ-575 (M3): "monday nov 24" when Nov 24 is a Tuesday — the typed
   *  date wins, and the wizard says which weekday it falls on. */
  weekdayMismatch?: true;
}

export interface QuoteFacts {
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  /** REQ-575 (demo-loop cycle 4, M3): a number typed as the phone that no
   *  phone can be ("phone 555", "tel 555-0123") — as typed, so the customer
   *  form can say so; absent when the text has a usable phone or none. */
  unusablePhone?: string;
  /** The typed START date (see StartDateFact). */
  startDate: StartDateFact | null;
  paymentTerms: PrefillPaymentTerms | null;
  /** The job's own time to complete, EN or ES — REQ-343: "4 weeks", "a
   *  4-hour clean" seeds the wizard's custom duration picker; REQ-330 (M21):
   *  "Thinking 4 weeks", "dos semanas" is offered on the duration step. */
  duration: ExtractedDuration | null;
}

export type { DurationUnit };
export interface ExtractedDuration {
  n: number;
  unit: DurationUnit;
}

const EMAIL_RE =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
/** A US phone: 10 digits, optional +1, separators - . space and (area). */
const PHONE_RE =
  /(?<![\d$.,])(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?![\d,.]\d)/;

export function extractEmail(raw: string): string | null {
  const m = raw.match(EMAIL_RE);
  return m ? m[0] : null;
}

export function extractPhone(raw: string): string | null {
  const m = raw.match(PHONE_RE);
  return m ? m[0].trim() : null;
}

/** REQ-575 (M3): a word that says the number after it is a phone. */
const PHONE_CUE =
  /(?<![\p{L}])(?:phone|tel|telephone|cell|cellphone|mobile|m[oó]vil|cel|celular|tel[eé]fono|whatsapp|(?:number|n[uú]mero)\s+(?:is|es))(?![\p{L}])/giu;
/** What follows the cue: "number", "is / es / de", ":" — then the digits as
 *  typed, single separators between their groups. */
const PHONE_AFTER_CUE =
  /^\.?\s*(?:(?:number|n[uú]mero|no\.?|num\.?)\s*)?(?:(?:is|es|de)\s+)?[:#]?\s*(\+?\(?\d+\)?(?:[\s.-]\(?\d+\)?)*)/iu;

/**
 * REQ-575 (demo-loop cycle 4, M3): pair 10 typed the phone "555" and the
 * assistant dropped it without a word. A number typed right after a phone
 * word ("phone 555", "tel: 555-0123", "su teléfono es 512 555", "his number
 * is 555") that is not a 10-digit US phone (11 with a leading 1) comes back
 * as typed; null when the text carries a usable phone, or no phone word.
 */
export function extractUnusablePhone(raw: string): string | null {
  const text = raw ?? "";
  if (extractPhone(text)) return null;
  for (const m of text.matchAll(PHONE_CUE)) {
    const typed = PHONE_AFTER_CUE.exec(text.slice(m.index! + m[0].length));
    if (!typed) continue;
    const value = typed[1].trim();
    const digits = value.replace(/\D/g, "");
    if (digits.length === 10 || (digits.length === 11 && digits[0] === "1")) {
      continue;
    }
    return value;
  }
  return null;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  ene: 1,
  enero: 1,
  feb: 2,
  february: 2,
  febrero: 2,
  mar: 3,
  march: 3,
  marzo: 3,
  apr: 4,
  april: 4,
  abr: 4,
  abril: 4,
  may: 5,
  mayo: 5,
  jun: 6,
  june: 6,
  junio: 6,
  jul: 7,
  july: 7,
  julio: 7,
  aug: 8,
  august: 8,
  ago: 8,
  agosto: 8,
  sep: 9,
  sept: 9,
  september: 9,
  septiembre: 9,
  setiembre: 9,
  oct: 10,
  october: 10,
  octubre: 10,
  nov: 11,
  november: 11,
  noviembre: 11,
  dec: 12,
  december: 12,
  dic: 12,
  diciembre: 12,
};

/** "start", "starting on", "begin", "kick off", "empezamos el", "inicia el",
 *  "comienza el" — the date that follows is the START date. */
const START_KEYWORD =
  /\b(?:start(?:s|ing|ed)?|begin(?:s|ning)?|kick(?:s|ing)?\s+off|empez\p{L}*|empiez\p{L}*|inici\p{L}*|comienz\p{L}*|comenz\p{L}*)\b/giu;
/** Filler allowed between the keyword and the date. REQ-575 (M3): "move
 *  the start to next week", "empezamos para el lunes". */
const FILLER =
  /^(?:\s|,|:|\bon\b|\bthe\b|\bdate\b|\bel\b|\bdía\b|\bdia\b|\bdel\b|\ba partir\b|\bto\b|\bpara\b)*/iu;

const pad = (n: number) => String(n).padStart(2, "0");

function resolve(
  month: number,
  day: number,
  year: number | null,
  today: Date,
): StartDateFact | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  let y = year ?? today.getFullYear();
  if (y < 100) y += 2000;
  const start = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  let d = new Date(y, month - 1, day);
  if (d.getMonth() !== month - 1) return null; // Feb 30 etc.
  // A date with no year that has passed means next year's.
  if (year === null && d < start) d = new Date(y + 1, month - 1, day);
  return {
    iso: `${d.getFullYear()}-${pad(month)}-${pad(day)}`,
    us: `${pad(month)}/${pad(day)}/${d.getFullYear()}`,
  };
}

/** REQ-331 (demo m7, pair 6 "I already said lunes!"): weekday words, EN
 *  and ES, accent-blind — JS getDay() numbering (0 = Sunday). */
const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  sun: 0,
  domingo: 0,
  monday: 1,
  mon: 1,
  lunes: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  martes: 2,
  wednesday: 3,
  wed: 3,
  miercoles: 3,
  thursday: 4,
  thu: 4,
  thurs: 4,
  jueves: 4,
  friday: 5,
  fri: 5,
  viernes: 5,
  saturday: 6,
  sat: 6,
  sabado: 6,
};
/** "next Monday", "this Friday", "el próximo lunes", "este sábado". */
const WEEKDAY_LEAD =
  /^(?:(?:next|this|coming|pr[oó]ximo|proximo|este|que viene)\s+)?/iu;

const ymd = (d: Date) => ({
  iso: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
  us: `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`,
});

/** The next occurrence of `weekday` strictly after today — "start Monday"
 *  said on a Monday means next week's, never a day already gone. */
function nextWeekday(
  weekday: number,
  today: Date,
): { iso: string; us: string } {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const ahead = ((weekday - d.getDay()) + 7) % 7 || 7;
  d.setDate(d.getDate() + ahead);
  return ymd(d);
}

/** REQ-575 (demo-loop cycle 4, M3): relative starts. Pair 7 corrected her
 *  start with "empezamos la próxima semana" — no reader knew it. */
const NEXT_WEEK =
  /^(?:de\s+)?(?:(?:la|the|this)\s+)?(?:(?:next|coming|following)\s+week|pr[oó]xima\s+semana|siguiente\s+semana|semana\s+(?:que\s+viene|pr[oó]xima|entrante|siguiente))(?![\p{L}])/iu;
const NEXT_MONTH =
  /^(?:de\s+)?(?:(?:el|the|this)\s+)?(?:(?:next|coming|following)\s+month|pr[oó]ximo\s+mes|siguiente\s+mes|mes\s+(?:que\s+viene|pr[oó]ximo|entrante|siguiente))(?![\p{L}])/iu;
const ASAP =
  /^(?:right\s+(?:away|now)|asap|a\.s\.a\.p\.?|immediately|de\s+inmediato|inmediatamente|ya\s+mismo|cuanto\s+antes|lo\s+(?:antes|m[aá]s\s+pronto)\s+posible)(?![\p{L}])/iu;
/** "in 2 weeks", "en 3 días", "dentro de un mes" — counted from today. */
const IN_SPAN =
  /^(?:in|en|dentro\s+de)\s+(\d{1,2}|\p{L}+)\s+(days?|weeks?|months?|d[ií]as?|semanas?|mes(?:es)?)(?![\p{L}])/iu;

const addDays = (today: Date, n: number) =>
  new Date(today.getFullYear(), today.getMonth(), today.getDate() + n);

function addMonths(today: Date, n: number): Date {
  const d = new Date(today.getFullYear(), today.getMonth() + n, 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(today.getDate(), last));
  return d;
}

/** REQ-575 (M3): "next week" → the wizard's Next week (a week from today,
 *  as completion-schedule counts it), "next month", "right away", "in N
 *  days / weeks / months"; null when `t` starts with none of them. */
function relativeStart(t: string, today: Date): StartDateFact | null {
  if (NEXT_WEEK.test(t)) {
    return { ...ymd(addDays(today, 7)), preset: "next_week" };
  }
  if (NEXT_MONTH.test(t)) {
    return { ...ymd(addMonths(today, 1)), preset: "next_month" };
  }
  if (ASAP.test(t)) return { ...ymd(addDays(today, 0)), preset: "asap" };
  const span = IN_SPAN.exec(t);
  if (span) {
    const tok = span[1].toLowerCase();
    const n = /^\d/.test(tok) ? Number(tok) : DURATION_WORD_NUMS[tok];
    if (!n) return null;
    const unit = span[2].toLowerCase();
    if (/^(?:month|mes)/.test(unit)) return ymd(addMonths(today, n));
    return ymd(addDays(today, /^(?:week|semana)/.test(unit) ? n * 7 : n));
  }
  return null;
}

/** "Dec 1", "December 1st", "Dec. 1, 2027", "1 de diciembre (de 2027)",
 *  "1st of December", "12/1", "12/01/2026", "12-1-26" at the start of `t`. */
function explicitDate(t: string, today: Date): StartDateFact | null {
  // "Dec 1", "December 1st", "Dec. 1, 2027"
  let m = t.match(
    /^(\p{L}+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?/iu,
  );
  if (m && MONTHS[m[1].toLowerCase()]) {
    return resolve(
      MONTHS[m[1].toLowerCase()],
      Number(m[2]),
      m[3] ? Number(m[3]) : null,
      today,
    );
  }
  // "1 de diciembre (de 2027)", "1 dic", "1st of December"
  m = t.match(
    /^(\d{1,2})(?:st|nd|rd|th)?\s+(?:(?:de|of)\s+)?(\p{L}+)\b(?:,?\s+(?:de\s+)?(\d{4}))?/iu,
  );
  if (m && MONTHS[m[2].toLowerCase()]) {
    return resolve(
      MONTHS[m[2].toLowerCase()],
      Number(m[1]),
      m[3] ? Number(m[3]) : null,
      today,
    );
  }
  // "12/1", "12/01/2026", "12-1-26"
  m = t.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?(?![\d/])/);
  if (m) {
    return resolve(
      Number(m[1]),
      Number(m[2]),
      m[3] ? Number(m[3]) : null,
      today,
    );
  }
  return null;
}

const weekdayOfIso = (iso: string) => {
  const [y, mo, d] = iso.split("-").map(Number);
  return new Date(y, mo - 1, d).getDay();
};

const WEEKDAY_LABELS: Record<"en" | "es", readonly string[]> = {
  en: [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ],
  es: [
    "domingo",
    "lunes",
    "martes",
    "miércoles",
    "jueves",
    "viernes",
    "sábado",
  ],
};

/** REQ-575 (M3): the weekday a YYYY-MM-DD date falls on, in `lang` — the
 *  wizard names it when the typed weekday is another ("monday nov 24"). */
export function weekdayLabel(iso: string, lang: "en" | "es"): string {
  return WEEKDAY_LABELS[lang === "es" ? "es" : "en"][weekdayOfIso(iso)] ?? "";
}

/** REQ-575 (M3): "el lunes 23", "Monday the 23rd" — a bare day of the month
 *  after a weekday, taken only when that day IS that weekday (in this month
 *  or the next two): "monday 3 guys" or "Monday 8 am" stay the weekday. */
function dayOfMonthOn(
  t: string,
  weekday: number,
  today: Date,
): StartDateFact | null {
  const m = t.match(/^(\d{1,2})(?:st|nd|rd|th)?\b/i);
  if (!m) return null;
  const dom = Number(m[1]);
  if (dom < 1 || dom > 31) return null;
  const start = addDays(today, 0);
  for (let k = 0; k < 3; k++) {
    const d = new Date(today.getFullYear(), today.getMonth() + k, dom);
    if (d.getDate() !== dom || d < start) continue;
    if (d.getDay() === weekday) return ymd(d);
  }
  return null;
}

/** Parse a date at the very start of `s` (after the start keyword). */
function parseDateAt(
  s: string,
  today: Date,
): StartDateFact | null {
  const t = s.replace(FILLER, "");
  // REQ-575 (M3): "next week", "la próxima semana", "right away", "in 2 weeks".
  const rel = relativeStart(t, today);
  if (rel) return rel;
  // REQ-331: "lunes", "next Monday", "this Friday", "tomorrow", "mañana".
  const lead = t.replace(WEEKDAY_LEAD, "");
  const w = lead.match(/^(\p{L}+)\b/u);
  if (w) {
    const word = w[1].normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    if (word in WEEKDAYS) {
      // REQ-575 (M3): pair 7's "we start monday nov 23" — a date typed after
      // the weekday wins over "the next Monday" (Nov 16); a weekday it does
      // not fall on is flagged.
      const rest = lead.slice(w[0].length).replace(
        /^[\s,]*(?:(?:the|el)\s+)?/iu,
        "",
      );
      const typed = explicitDate(rest, today);
      if (typed) {
        return weekdayOfIso(typed.iso) === WEEKDAYS[word]
          ? typed
          : { ...typed, weekdayMismatch: true };
      }
      return dayOfMonthOn(rest, WEEKDAYS[word], today) ??
        nextWeekday(WEEKDAYS[word], today);
    }
    if (word === "tomorrow" || word === "manana") {
      return ymd(addDays(today, 1));
    }
    // REQ-575 (M3): "we start today" / "empezamos hoy".
    if (word === "today" || word === "hoy") return ymd(addDays(today, 0));
  }
  return explicitDate(t, today);
}

/** The START date the text states — only a date tied to a start word. */
export function extractStartDate(
  raw: string,
  today: Date,
): StartDateFact | null {
  for (const m of raw.matchAll(START_KEYWORD)) {
    const after = raw.slice(
      m.index! + m[0].length,
      m.index! + m[0].length + 40,
    );
    const d = parseDateAt(after, today);
    if (d) return d;
  }
  return null;
}

const PERCENT_RE =
  /(?<![\d.])(\d{1,3}(?:\.\d+)?)\s*(?:%|percent\b|por\s*ciento\b)/giu;
/** A word that makes a run of percentages a PAYMENT schedule. */
const PAYMENT_WORD_RE =
  /(?:deposit|down\b|upfront|up front|payment|\bpay|balance|completion|complete|finish|done\b|install|milestone|pago|paga|anticipo|adelanto|enganche|dep[oó]sito|saldo|terminar|final)/iu;

/**
 * REQ-387 (demo M25): the first run of 2+ consecutive percentages that adds
 * up to exactly 100, with each payment's own words — the text after its
 * figure up to the next figure or separator. Null when the text states no
 * such run, or says nothing about payment.
 */
function extractSplitSchedule(raw: string): CustomPaymentSchedule | null {
  if (!PAYMENT_WORD_RE.test(raw)) return null;
  const hits = [...raw.matchAll(PERCENT_RE)].map((m) => ({
    pct: Number(m[1]),
    start: m.index!,
    end: m.index! + m[0].length,
  }));
  for (let i = 0; i < hits.length; i++) {
    let sum = 0;
    for (let j = i; j < hits.length && j - i < 6; j++) {
      sum += hits[j].pct;
      if (sum > 100) break;
      if (sum === 100 && j > i) {
        const run = hits.slice(i, j + 1);
        if (run.some((h) => h.pct <= 0)) break;
        return {
          kind: "custom",
          splits: run.map((h) => h.pct),
          milestones: run.map((h, k) => {
            const stop = k + 1 < run.length ? run[k + 1].start : raw.length;
            const words = raw.slice(h.end, stop).split(/[,;.\n/]/)[0]
              .replace(/\s+/g, " ")
              .replace(/\s+(?:and|y|then|luego|e)\s*$/iu, "")
              .trim();
            return words && words.length <= 40 ? words : null;
          }),
        };
      }
    }
  }
  return null;
}

/** The payment schedule the text states, mapped onto the wizard's options —
 *  a preset when it is one, else (REQ-387) the stated custom schedule. */
export function extractPaymentTerms(raw: string): PrefillPaymentTerms | null {
  const s = raw.toLowerCase();
  // REQ-387 (demo M25): a stated multi-payment schedule wins over the
  // single-figure "N% deposit" rule below (which read 30/40/30 as
  // "Deposit + balance").
  const schedule = extractSplitSchedule(raw);
  if (schedule) {
    const key = schedule.splits.join("/");
    if (key === "30/30/40") return "30_30_40";
    if (key === "50/50") return "50_50";
    return schedule;
  }
  if (/\b30\s*\/\s*30\s*\/\s*40\b/.test(s)) return "30_30_40";
  if (/\b50\s*\/\s*50\b/.test(s)) return "50_50";
  const depositWord =
    "(?:deposit|down|upfront|up front|up-front|anticipo|adelanto|adelantado|enganche|dep[oó]sito)";
  const half = "(?:50\\s*%|half|la mitad|mitad)";
  if (
    new RegExp(`${half}[^.;\\n]{0,20}?${depositWord}`, "u").test(s) ||
    new RegExp(`${depositWord}[^.;\\n]{0,12}?${half}`, "u").test(s)
  ) {
    return "50_50";
  }
  if (
    new RegExp(
      `(?:\\d{1,2}\\s*%|\\$\\s*[\\d,]+)[^.;\\n]{0,12}?${depositWord}`,
      "u",
    )
      .test(s) ||
    new RegExp(
      `${depositWord}\\s+(?:of\\s+|del?\\s+)?(?:\\d{1,2}\\s*%|\\$)`,
      "u",
    )
      .test(s)
  ) {
    return "deposit_bal";
  }
  if (/\bnet\s*-?\s*15\b/.test(s)) return "net_15";
  return null;
}

const DURATION_WORD_NUMS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  un: 1,
  una: 1,
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
};

/** REQ-575 (demo-loop cycle 4, M3): "and a half" / "y media(o)" — pair 7's
 *  "Dos semanas y media" was read as 2 weeks. */
const HALF = String.raw`(?:and\s+a\s+half|y\s+medi[ao])`;
const DURATION_RE = new RegExp(
  String
    .raw`(?<![\d.,])(\d{1,2}(?:[.,]5)?|\p{L}+)(\s*½|\s+${HALF})?\s*(?:[-–]\s*(?:\d{1,2}\s*)?)?(hours?|hrs?|horas?|d[ií]as?|days?|semanas?|weeks?|wks?|meses|mes|months?|mos?)\b(\s+${HALF}(?![\p{L}]))?`,
  "giu",
);

/**
 * The time to complete the text states, EN or ES — "Thinking 4 weeks",
 * "3 días", "dos semanas" (REQ-330, M21), "a 4-hour deep clean", "toma 5
 * horas" (REQ-343: service trades quote in hours). REQ-575 (M3): a half is
 * kept — "Dos semanas y media", "two and a half weeks", "2.5 weeks", "2½
 * weeks" are 2.5 weeks; "a week and a half" is 1.5. A span that is a START
 * offset ("start in 2 weeks", "empezamos en 2 semanas"), a warranty ("2 week
 * warranty") or a payment term ("net 30 days") is not a duration. Null when
 * the text says nothing.
 */
export function extractDuration(raw: string): ExtractedDuration | null {
  const text = raw ?? "";
  for (const m of text.matchAll(DURATION_RE)) {
    const numTok = m[1].toLowerCase();
    const whole = /^\d/.test(numTok)
      ? Number(numTok.replace(",", "."))
      : DURATION_WORD_NUMS[numTok];
    if (!whole || !Number.isFinite(whole) || whole <= 0) continue;
    const n = whole + (m[2] || m[4] ? 0.5 : 0);
    const before = text.slice(Math.max(0, m.index! - 40), m.index!)
      .toLowerCase();
    // "start in 2 weeks" / "starting in 3 days" / "empezamos en 2 semanas"
    // / "dentro de 2 semanas" is a start offset, not a duration.
    if (/\b(?:in|en|dentro de)\s*$/.test(before)) continue;
    // "net 30 days" / "neto 30 días" is a payment term (REQ-343).
    if (/\b(?:net|neto)\s*$/.test(before)) continue;
    const after = text.slice(m.index! + m[0].length).trimStart()
      .toLowerCase();
    // "2 week warranty" / "2 semanas de garantía" is a warranty span.
    if (/^(?:of\s+|de\s+)?(?:warranty|guarantee|garant[ií]a)/.test(after)) {
      continue;
    }
    const u = m[3].toLowerCase();
    const unit: DurationUnit = /^(?:h|hora)/.test(u)
      ? "hours"
      : /^d/.test(u)
      ? "days"
      : /^(?:semana|week|wk)/.test(u)
      ? "weeks"
      : "months";
    return { n: Math.max(1, Math.min(99, Math.round(n * 2) / 2)), unit };
  }
  return null;
}

/** Every fact in one call. `today` anchors a year-less start date. */
export function extractQuoteFacts(raw: string, today: Date): QuoteFacts {
  const text = raw ?? "";
  const unusablePhone = extractUnusablePhone(text);
  return {
    customerName: extractCustomerName(text),
    customerPhone: extractPhone(text),
    customerEmail: extractEmail(text),
    ...(unusablePhone ? { unusablePhone } : {}),
    startDate: extractStartDate(text, today),
    paymentTerms: extractPaymentTerms(text),
    duration: extractDuration(text),
  };
}

/**
 * REQ-575 (demo-loop cycle 4, M3): the text the facts are read from — what
 * the user typed in the thread FIRST, then the quote's description (the
 * starter-chip flow's raw sentence, or the picked / polished job details).
 * Pair 7's description "…for the Hendersons" was read before her own "Carol
 * Henderson", and the household won.
 */
export function factsSourceText(
  description: string | null | undefined,
  userTexts: readonly string[],
): string {
  return [...userTexts, description ?? ""]
    .filter((s) => s.trim().length > 0)
    .join("\n");
}

export interface WizardPrefill {
  optionId: string;
  customValue?: string;
  /** REQ-387: a custom payment schedule's percentages — seeds the Custom
   *  payment form when the contractor opens it instead of taking the
   *  prefill as is. */
  splits?: number[];
}

/** The wizard step's pre-selection from the facts; null when the text said
 *  nothing about that step. `lang` is the wizard's language — a custom
 *  duration is submitted as the localized term string ("4 semanas"), the
 *  way the manual duration control submits it (P-25). */
export function wizardPrefillFor(
  stepId: string | undefined,
  facts: QuoteFacts,
  lang: "en" | "es" = "en",
): WizardPrefill | null {
  if (stepId === "start_date" && facts.startDate) {
    // REQ-575 (M3): "next week" / "la próxima semana" is the wizard's own
    // option — the term then reads as the contractor said it.
    if (facts.startDate.preset) return { optionId: facts.startDate.preset };
    // REQ-495 (m17): the start term is stored ISO, like the picker submits.
    return { optionId: "custom", customValue: facts.startDate.iso };
  }
  if (stepId === "payment_terms" && facts.paymentTerms) {
    const pt = facts.paymentTerms;
    if (typeof pt === "string") return { optionId: pt };
    // REQ-387 (demo M25): the typed schedule pre-fills the Custom option.
    // Named milestones ride in the value ("30% deposit / 40% at cabinets
    // install / 30% at completion") — computePaymentSplit still reads its
    // percentages; without names it is the custom form's own "30 / 40 / 30".
    const named = pt.milestones.every((m) => !!m);
    return {
      optionId: "custom",
      customValue: named
        ? pt.splits.map((n, i) => `${n}% ${pt.milestones[i]}`).join(" / ")
        : termLabel({ kind: "payment", value: { splits: pt.splits } }, lang),
      splits: pt.splits,
    };
  }
  // REQ-330 (M21): a typed duration lands on the wraps step — a preset when
  // it matches one (1 day / 1 week / 2 weeks), else the custom value.
  if (stepId === "wraps" && facts.duration) {
    const { n, unit } = facts.duration;
    if (unit === "days" && n === 1) return { optionId: "1_day" };
    if (unit === "weeks" && n === 1) return { optionId: "1_week" };
    if (unit === "weeks" && n === 2) return { optionId: "2_weeks" };
    return {
      optionId: "custom",
      customValue: termLabel({ kind: "duration", value: { n, unit } }, lang),
    };
  }
  return null;
}

const fold = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();
const last10 = (p: string | undefined | null) => {
  const d = (p ?? "").replace(/\D/g, "");
  return d.length > 10 ? d.slice(-10) : d;
};

/** The existing customer the typed facts name — by phone, then email, then
 *  name (accent- and case-blind). */
export function matchPrefillCustomer<
  C extends {
    name: string;
    email?: string | null;
    phoneNumber?: string | null;
  },
>(customers: C[] | null | undefined, facts: QuoteFacts): C | null {
  const list = customers ?? [];
  const phone = last10(facts.customerPhone);
  if (phone.length === 10) {
    const hit = list.find((c) => last10(c.phoneNumber) === phone);
    if (hit) return hit;
  }
  if (facts.customerEmail) {
    const e = facts.customerEmail.toLowerCase();
    const hit = list.find((c) => (c.email ?? "").trim().toLowerCase() === e);
    if (hit) return hit;
  }
  if (facts.customerName) {
    const n = fold(facts.customerName);
    const hit = list.find((c) => fold(c.name) === n);
    if (hit) return hit;
  }
  return null;
}

/** The customer step's view once the facts are known: a typed customer the
 *  account does not have yet opens the create form (filled); a match stays
 *  on the pick list; no typed customer keeps the default view. */
export function customerStepPrefillView(
  baseView: "list" | "form",
  facts: QuoteFacts,
  matched: boolean,
): "list" | "form" {
  if (matched) return "list";
  const typed = !!(facts.customerName || facts.customerPhone ||
    facts.customerEmail);
  return typed && facts.customerName ? "form" : baseView;
}
