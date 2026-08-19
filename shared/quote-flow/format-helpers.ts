/**
 * Pure display formatters shared by the FE and backend card builders
 * (problems.md P-34 / P-59 / P-64 / P-65). No I/O, no Intl dependence —
 * every output is deterministic across Deno, Node/jest and the browser.
 */

type Lang = "en" | "es";

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

type DateLike = Date | string | number;

function toMs(d: DateLike): number {
  return d instanceof Date ? d.getTime() : new Date(d).getTime();
}

/**
 * Relative "how long ago" localized to the viewer — Spanish reads
 * "hace 3 min" / "hace 2 días", never the raw English "3m ago" (P-34/P-59).
 */
export function relativeTime(
  then: DateLike,
  now: DateLike,
  lang: Lang,
): string {
  const diff = Math.max(0, toMs(now) - toMs(then));

  if (diff < MIN) {
    return lang === "es" ? "hace un momento" : "just now";
  }
  if (diff < HOUR) {
    const m = Math.floor(diff / MIN);
    return lang === "es" ? `hace ${m} min` : `${m}m ago`;
  }
  if (diff < DAY) {
    const h = Math.floor(diff / HOUR);
    return lang === "es" ? `hace ${h} h` : `${h}h ago`;
  }
  const d = Math.floor(diff / DAY);
  if (lang === "es") return `hace ${d} ${d === 1 ? "día" : "días"}`;
  return `${d}d ago`;
}

/** Event sentences start with a capital; the rest is left untouched (P-59). */
export function sentenceCase(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Digits only, leading US country code stripped — "" when unusable. */
function tenDigits(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1")
    ? digits.slice(1)
    : digits;
}

/**
 * One phone display everywhere: "5125556999" → "+1 (512) 555-6999".
 * Idempotent on already-formatted +1 numbers; non-10-digit inputs pass
 * through untouched rather than mangled (P-64).
 */
export function formatPhoneDisplay(raw: string): string {
  const digits = tenDigits(raw);
  if (digits.length !== 10) return raw.trim();
  return `+1 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/** "5125556999" / "+1 (512) 555-6999" → "tel:+15125556999" (P-64). */
export function telHref(raw: string): string {
  const digits = tenDigits(raw);
  if (digits.length === 10) return `tel:+1${digits}`;
  return digits ? `tel:+${digits}` : `tel:${raw.trim()}`;
}

/**
 * ONE grouping convention for both languages — comma thousands
 * (Mexican/neutral-LatAm and en agree) so a page never mixes
 * "$10,990" with "48.215" (P-64).
 */
export function formatNumber(n: number, _lang?: Lang): string {
  const [whole, frac] = Math.abs(n).toString().split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sign = n < 0 ? "-" : "";
  return `${sign}${grouped}${frac !== undefined ? `.${frac}` : ""}`;
}

/** No address claim without an address — blank/whitespace is none (P-64). */
export function hasAddress(client: { address?: string | null }): boolean {
  return typeof client.address === "string" && client.address.trim().length > 0;
}

/**
 * Fold a standalone phrase into the middle of a sentence ("This estimate
 * covers <phrase> — ...") without destroying proper nouns.
 *
 * The customer's quote used to read "…covers reparación de tablaroca y
 * pintura en 2 cuartos — ramírez — 2 lines of work…": the whole summary was
 * pushed through toLowerCase(), which lowercases the CLIENT'S SURNAME. Only
 * the first character is a sentence-position artifact, and only when the
 * opening word is an ordinary capitalized word — an ALL-CAPS acronym ("HVAC")
 * and an already-lowercase word are both left exactly as written.
 */
export function midSentence(s: string): string {
  const trimmed = s.trim();
  if (!trimmed) return trimmed;
  const first = trimmed.split(/\s+/)[0];
  // "HVAC", "LED" — an acronym keeps its case.
  if (first.length > 1 && first === first.toUpperCase()) return trimmed;
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

const MONTHS: Record<Lang, readonly string[]> = {
  en: [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ],
  es: [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
  ],
};

/**
 * The ONE long-date format for customer-facing documents, in the document's
 * own language: en "August 18, 2026", es "18 de agosto de 2026".
 *
 * The signed agreement used to print "FIRMADO AUGUST 18, 2026" and "vigente
 * August 18, 2026" — English dates embedded in Spanish legal copy — because
 * every renderer called toLocaleDateString("en-US") unconditionally.
 *
 * Deterministic by construction (no Intl), like everything else in this
 * module: a bare "YYYY-MM-DD" is read as calendar-local noon UTC so it can
 * never slip a day, and an unparseable value passes through untouched.
 */
export function formatLongDate(iso: string | undefined, lang: Lang): string {
  if (!iso) return "";
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const d = new Date(dateOnly ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(+d)) return iso;
  const day = d.getUTCDate();
  const month = MONTHS[lang === "es" ? "es" : "en"][d.getUTCMonth()];
  const year = d.getUTCFullYear();
  return lang === "es"
    ? `${day} de ${month} de ${year}`
    : `${month} ${day}, ${year}`;
}

const SHORT_MONTHS: Record<Lang, readonly string[]> = {
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
  // Agrees with lang/es.json invoicesPage.month.* — the table the invoice
  // cards already render.
  es: [
    "ene",
    "feb",
    "mar",
    "abr",
    "may",
    "jun",
    "jul",
    "ago",
    "sep",
    "oct",
    "nov",
    "dic",
  ],
};

/**
 * The ONE short month-day format for in-app compact dates (UX-38):
 * en "Aug 25" (month-first, TitleCase 3-letter), es "25 ago" (day-first,
 * lowercase 3-letter). Deterministic like formatLongDate: a bare
 * "YYYY-MM-DD" is read as calendar-local noon UTC so it can never slip a
 * day; an unparseable value passes through untouched.
 */
export function formatShortDate(iso: string, lang: Lang): string {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const d = new Date(dateOnly ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(+d)) return iso;
  const day = d.getUTCDate();
  const month = SHORT_MONTHS[lang === "es" ? "es" : "en"][d.getUTCMonth()];
  return lang === "es" ? `${day} ${month}` : `${month} ${day}`;
}

/**
 * Spanish weekday lines are lowercase from the locale ("viernes · agosto
 * 17") but a greeting line starts a sentence — capitalize the leading
 * character only (P-65).
 */
export function capitalizeDateLine(line: string, _lang?: Lang): string {
  return sentenceCase(line);
}
