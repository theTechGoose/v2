/**
 * REQ-276 (demo i18n-formatting-m8): formatters that follow the APP language,
 * never the browser locale or English word order. Pure and deterministic (no
 * Intl), like format-helpers.ts — the same output in Deno, jest and browsers.
 *
 *   numberInWords(450, "es")      → "cuatrocientos cincuenta"
 *   amountInWords(2100, "es")     → "veintiún dólares"
 *   formatClockTime(d, "es")      → "8:55 p. m."
 *   formatGreetingDate(d, "es")   → "Miércoles · 11 de noviembre"
 */

type Lang = "en" | "es";

/* ----------------------------- English ------------------------------ */

const EN_ONES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const EN_TENS = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
];

function enWords(n: number): string {
  if (n < 20) return EN_ONES[n];
  if (n < 100) {
    const o = n % 10;
    return o === 0
      ? EN_TENS[Math.floor(n / 10)]
      : `${EN_TENS[Math.floor(n / 10)]}-${EN_ONES[o]}`;
  }
  if (n < 1000) {
    const r = n % 100;
    const head = `${EN_ONES[Math.floor(n / 100)]} hundred`;
    return r === 0 ? head : `${head} ${enWords(r)}`;
  }
  if (n < 1_000_000) {
    const r = n % 1000;
    const head = `${enWords(Math.floor(n / 1000))} thousand`;
    return r === 0 ? head : `${head} ${enWords(r)}`;
  }
  const r = n % 1_000_000;
  const head = `${enWords(Math.floor(n / 1_000_000))} million`;
  return r === 0 ? head : `${head} ${enWords(r)}`;
}

/* ----------------------------- Spanish ------------------------------ */

const ES_UNITS = [
  "cero",
  "uno",
  "dos",
  "tres",
  "cuatro",
  "cinco",
  "seis",
  "siete",
  "ocho",
  "nueve",
  "diez",
  "once",
  "doce",
  "trece",
  "catorce",
  "quince",
  "dieciséis",
  "diecisiete",
  "dieciocho",
  "diecinueve",
  "veinte",
  "veintiuno",
  "veintidós",
  "veintitrés",
  "veinticuatro",
  "veinticinco",
  "veintiséis",
  "veintisiete",
  "veintiocho",
  "veintinueve",
];
const ES_TENS = [
  "",
  "",
  "",
  "treinta",
  "cuarenta",
  "cincuenta",
  "sesenta",
  "setenta",
  "ochenta",
  "noventa",
];
const ES_HUNDREDS = [
  "",
  "ciento",
  "doscientos",
  "trescientos",
  "cuatrocientos",
  "quinientos",
  "seiscientos",
  "setecientos",
  "ochocientos",
  "novecientos",
];

/** 0–999 as a standalone number ("uno", "veintiuno"). */
function esBelowThousand(n: number): string {
  if (n < 30) return ES_UNITS[n];
  if (n < 100) {
    const o = n % 10;
    const t = ES_TENS[Math.floor(n / 10)];
    return o === 0 ? t : `${t} y ${ES_UNITS[o]}`;
  }
  if (n === 100) return "cien";
  const r = n % 100;
  const h = ES_HUNDREDS[Math.floor(n / 100)];
  return r === 0 ? h : `${h} ${esBelowThousand(r)}`;
}

/** Before a masculine noun or "mil"/"millón", a final "uno" is "un"
 *  ("veintiún mil", "un dólar", "treinta y un dólares"). */
function apocope(words: string): string {
  return words.replace(/veintiuno$/, "veintiún").replace(/\buno$/, "un");
}

function esWords(n: number): string {
  if (n < 1000) return esBelowThousand(n);
  if (n < 1_000_000) {
    const k = Math.floor(n / 1000);
    const r = n % 1000;
    const head = k === 1 ? "mil" : `${apocope(esBelowThousand(k))} mil`;
    return r === 0 ? head : `${head} ${esBelowThousand(r)}`;
  }
  const m = Math.floor(n / 1_000_000);
  const r = n % 1_000_000;
  const head = m === 1 ? "un millón" : `${apocope(esWords(m))} millones`;
  return r === 0 ? head : `${head} ${esWords(r)}`;
}

/** A whole number in words, in the language's own grammar. */
export function numberInWords(n: number, lang: Lang): string {
  if (!Number.isFinite(n) || n < 0) return "";
  const i = Math.floor(n);
  return lang === "es" ? esWords(i) : enWords(i);
}

/** Cents as the MoneyInput "in words" line: "cuatrocientos cincuenta dólares
 *  con veinticinco centavos" / "four hundred fifty dollars and twenty-five
 *  cents". */
export function amountInWords(cents: number, lang: Lang): string {
  if (!Number.isFinite(cents) || cents < 0) return "";
  if (cents === 0) return lang === "es" ? "cero dólares" : "zero dollars";
  const dollars = Math.floor(cents / 100);
  const c = Math.round(cents % 100);
  if (lang === "es") {
    const dLabel = dollars === 1 ? "dólar" : "dólares";
    // "un millón de dólares": an exact million takes "de".
    const de = dollars >= 1_000_000 && dollars % 1_000_000 === 0 ? " de" : "";
    const dPart = dollars === 0
      ? ""
      : `${apocope(esWords(dollars))}${de} ${dLabel}`;
    if (c === 0) return dPart;
    const cPart = `${apocope(esWords(c))} ${c === 1 ? "centavo" : "centavos"}`;
    return dPart ? `${dPart} con ${cPart}` : cPart;
  }
  const dPart = dollars === 0
    ? ""
    : `${enWords(dollars)} ${dollars === 1 ? "dollar" : "dollars"}`;
  if (c === 0) return dPart;
  const cPart = `${enWords(c)} ${c === 1 ? "cent" : "cents"}`;
  return dPart ? `${dPart} and ${cPart}` : cPart;
}

/* ------------------------------ Times ------------------------------- */

type DateLike = Date | string | number;

/** A clock time in the viewer's local zone, written the app language's way:
 *  en "8:55 PM", es "8:55 p. m." (12-hour, as US Spanish reads it). */
export function formatClockTime(when: DateLike, lang: Lang): string {
  const d = when instanceof Date ? when : new Date(when);
  if (Number.isNaN(+d)) return "";
  const h24 = d.getHours();
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  const mm = String(d.getMinutes()).padStart(2, "0");
  const pm = h24 >= 12;
  if (lang === "es") return `${h}:${mm} ${pm ? "p. m." : "a. m."}`;
  return `${h}:${mm} ${pm ? "PM" : "AM"}`;
}

const WEEKDAYS: Record<Lang, readonly string[]> = {
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

/** The topbar's date line, in the viewer's local zone and the language's own
 *  order: en "Wednesday · November 11", es "Miércoles · 11 de noviembre"
 *  (the line opens a sentence, so the Spanish weekday is capitalised). */
export function formatGreetingDate(when: DateLike, lang: Lang): string {
  const d = when instanceof Date ? when : new Date(when);
  if (Number.isNaN(+d)) return "";
  const l: Lang = lang === "es" ? "es" : "en";
  const weekday = WEEKDAYS[l][d.getDay()];
  const month = MONTHS[l][d.getMonth()];
  if (l === "es") {
    const wd = weekday.charAt(0).toUpperCase() + weekday.slice(1);
    return `${wd} · ${d.getDate()} de ${month}`;
  }
  return `${weekday} · ${month} ${d.getDate()}`;
}
