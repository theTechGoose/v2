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

/** Both deterministic halves in one call. */
export function extractQuickQuotePrefill(raw: string): QuickQuotePrefill {
  return {
    priceCents: extractPriceCents(raw),
    customerName: extractCustomerName(raw),
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
