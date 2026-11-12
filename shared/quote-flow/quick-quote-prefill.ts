/**
 * Quick-quote prefill (UX-04 / UX-32) — the deterministic, regex-extractable
 * facts in a typed quick-quote sentence ("Instalación de patio … para la
 * familia Nguyen, $3,700 todo incluido"): the $-amount and the "para <Name>"
 * customer candidate. The assistant must seed its price picker and customer
 * step from these instead of asking for answers the user already typed.
 *
 * Pure logic, no side effects.
 */

export interface QuickQuotePrefill {
  priceCents: number | null;
  customerName: string | null;
  /** REQ-263: the job (service) address typed in the sentence. */
  serviceAddress: string | null;
}

const CURRENCY_WORDS = /^(d[oó]lares|dollars|usd|pesos)$/i;

function toCents(whole: string, frac: string | undefined): number {
  const dollars = Number(whole.replace(/,/g, ""));
  const cents = frac ? Number(frac.padEnd(2, "0").slice(0, 2)) : 0;
  return dollars * 100 + cents;
}

/**
 * The price in the sentence, INTEGER CENTS:
 *   - "$3,700" → 370000; "$1,850.50" → 185050; "$3700" → 370000;
 *   - "3700 dólares" (number + currency word) → 370000;
 *   - bare numbers/dimensions (20x15, 6 paneles) are never a price;
 *   - several amounts → the LARGEST wins (deposit vs. total);
 *   - none / zero → null.
 */
export function extractPriceCents(raw: string): number | null {
  const candidates: number[] = [];

  const dollarRe = /\$\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g;
  for (const m of raw.matchAll(dollarRe)) {
    candidates.push(toCents(m[1], m[2]));
  }

  const wordRe =
    /(?<![\d.,])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s+(\p{L}+)/gu;
  for (const m of raw.matchAll(wordRe)) {
    if (CURRENCY_WORDS.test(m[3])) candidates.push(toCents(m[1], m[2]));
  }

  const best = Math.max(0, ...candidates);
  return best > 0 ? best : null;
}

/** A run token: Capitalized Unicode-letter word (apostrophes/hyphens ok). */
const CAP_TOKEN = /^[\p{Lu}][\p{L}'’-]*$/u;

/**
 * The "para/for <Name>" customer candidate:
 *   - the run of Capitalized tokens after "para"/"for" (+ optional article
 *     el/la/los/las/the); the run stops at a comma, a digit, a "$" or a
 *     lowercase token;
 *   - ES household form: "para la familia Nguyen" → "Familia Nguyen";
 *   - EN postfix form: "for the Smith family" → "Smith family";
 *   - no phrase → null (never a hallucinated name).
 */
export function extractCustomerName(raw: string): string | null {
  const lead = /\b(?:para|for)\s+(?:(?:el|la|los|las|the)\s+)?/giu;
  for (const m of raw.matchAll(lead)) {
    const rest = raw.slice(m.index! + m[0].length);
    const tokens = rest.split(/\s+/);
    let household = false;
    let i = 0;
    if (tokens[0] && /^familia$/i.test(tokens[0])) {
      household = true;
      i = 1;
    }
    const run: string[] = [];
    let stopped = false;
    for (; i < tokens.length && !stopped; i++) {
      let tok = tokens[i];
      if (!tok) break;
      if (/^[$\d]/.test(tok)) break;
      if (/[,;:.]$/.test(tok)) {
        tok = tok.replace(/[,;:.]+$/, "");
        stopped = true;
      }
      if (!CAP_TOKEN.test(tok)) {
        // EN postfix household word closes the run.
        if (run.length > 0 && /^family$/i.test(tok)) {
          run.push(tok.toLowerCase());
        }
        break;
      }
      run.push(tok);
    }
    if (run.length === 0) continue;
    if (household) return `Familia ${run.join(" ")}`;
    return run.join(" ");
  }
  return null;
}

/** Street-type words that close the street part of a US address. */
const STREET_SUFFIX =
  "St|Street|Ave|Av|Avenue|Rd|Road|Dr|Drive|Blvd|Boulevard|Ln|Lane|Ct|Court|Way|Pl|Place|Pkwy|Parkway|Cir|Circle|Ter|Terrace|Trl|Trail|Hwy|Highway|Cv|Cove|Sq|Square";
/** Abbreviated street types: a period after one is the abbreviation's, not
 *  the end of the sentence ("412 Oak St. Austin"). */
const STREET_ABBREV =
  /^(St|Ave|Av|Rd|Dr|Blvd|Ln|Ct|Pl|Pkwy|Cir|Ter|Trl|Hwy|Cv|Sq)$/;

/**
 * REQ-263 (demo ai-assistant-m2) — the job (service) address in the typed
 * sentence: a house number, one to four street-name words, a street-type word
 * (St / Ave / Rd / Dr / …), then the Capitalized city, two-letter state and
 * ZIP that follow it. The address ends at a colon, a "$", a lowercase word or
 * the end of the text:
 *   - "…for Maria Lopez, 412 Oak St Austin, $350" → "412 Oak St Austin";
 *   - "1800 Barton Hills Dr, Austin, TX 78704" → kept whole;
 *   - no street-type word → null (never a made-up address; "6 paneles",
 *     "3 bedrooms", a phone number are never one).
 */
export function extractServiceAddress(raw: string): string | null {
  const street = new RegExp(
    `(?<![\\d$.,\\-/])(\\d{1,6}[A-Za-z]?)\\s+((?:[\\p{Lu}\\d][\\p{L}\\d'’.-]*\\s+){1,4}?)(${STREET_SUFFIX})\\.?(?=[\\s,;:]|$)`,
    "u",
  );
  const m = street.exec(raw);
  if (!m) return null;
  let out = `${m[1]} ${m[2]}${m[3]}`.replace(/\s+/g, " ").trim();
  // "…Lake Avenue. Total $900" — a full street word then a period ends it.
  if (m[0].endsWith(".") && !STREET_ABBREV.test(m[3])) return out;
  // City / state / ZIP: Capitalized words, a 2-letter state, a 5(+4)-digit
  // ZIP, separated by spaces or single commas.
  const rest = raw.slice(m.index + m[0].length);
  const tail = /^(\s*,?\s*)([\p{Lu}][\p{L}'’-]*|\d{5}(?:-\d{4})?)/u;
  let cursor = rest;
  let words = 0;
  for (;;) {
    const t = tail.exec(cursor);
    if (!t || words >= 5) break;
    out += `${t[1].includes(",") ? ", " : " "}${t[2]}`;
    cursor = cursor.slice(t[0].length);
    words++;
    if (/^\d/.test(t[2])) break; // the ZIP closes it
  }
  return out;
}

/** All the deterministic facts in one call. */
export function extractQuickQuotePrefill(raw: string): QuickQuotePrefill {
  return {
    priceCents: extractPriceCents(raw),
    customerName: extractCustomerName(raw),
    serviceAddress: extractServiceAddress(raw),
  };
}

/** "$3,700" / "$1,850.50" — cents kept only when non-zero. */
function formatMoney(cents: number): string {
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac === 0
    ? `$${grouped}`
    : `$${grouped}.${String(frac).padStart(2, "0")}`;
}

/**
 * The accepted-job chip the facturar flow offers instead of a cold
 * "¿De qué trabajo es la factura?": names the job, the customer (when
 * known) and the agreed total — never "$0".
 */
export function acceptedJobChipLabel(
  job: { jobName: string; customerName?: string | null; totalCents: number },
  lang: "en" | "es",
): string {
  const who = (job.customerName ?? "").trim();
  const money = job.totalCents > 0 ? ` — ${formatMoney(job.totalCents)}` : "";
  if (lang === "es") {
    return who
      ? `Factura de ${job.jobName} para ${who}${money}`
      : `Factura de ${job.jobName}${money}`;
  }
  return who
    ? `Invoice for ${job.jobName} — ${who}${money}`
    : `Invoice for ${job.jobName}${money}`;
}
