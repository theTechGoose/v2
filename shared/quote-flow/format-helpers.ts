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
 * Spanish weekday lines are lowercase from the locale ("viernes · agosto
 * 17") but a greeting line starts a sentence — capitalize the leading
 * character only (P-65).
 */
export function capitalizeDateLine(line: string, _lang?: Lang): string {
  return sentenceCase(line);
}
