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
  /** REQ-259: the priced lines of an itemised sentence ("demo $2,500,
   *  cabinets $8,000, …"), in order; [] when the sentence is not a list. */
  lines: PriceLine[];
}

/** REQ-259: one priced line the user typed — its label and INTEGER CENTS. */
export interface PriceLine {
  label: string;
  cents: number;
}

const CURRENCY_WORDS = /^(d[oó]lares|dollars|usd|pesos)$/i;

/** A word that marks an amount as the whole job's price. */
const TOTAL_WORD =
  /\b(total|in all|all[- ]in|todo incluido|en total|grand total)\b/i;
/** A word that marks an amount as an up-front part of the price, not a line. */
const DEPOSIT_WORD =
  /(\bdeposits?\b|\bdown\b|\bupfront\b|\bup[- ]front\b|\bretainer\b|\banticipos?\b|\badelantos?\b|\benganches?\b|\bdep[oó]sitos?\b|%)/i;
/** Text that only separates two amounts as alternatives ("$3,000 - $4,000",
 *  "$3,000 to $4,000", "$3,000 or $4,000") — a range, not a list. */
const RANGE_GAP = /^\s*(-|–|—|to|or|a|o|hasta)\s*$/i;
/** Where one item's text ends and the next begins. */
const ITEM_BREAK = /[,;:\n]/;

function toCents(whole: string, frac: string | undefined): number {
  const dollars = Number(whole.replace(/,/g, ""));
  const cents = frac ? Number(frac.padEnd(2, "0").slice(0, 2)) : 0;
  return dollars * 100 + cents;
}

interface Amount {
  cents: number;
  start: number;
  end: number;
  /** The words leading up to the amount, back to the previous item break. */
  before: string;
  /** The words after the amount, up to the next item break. */
  after: string;
  /** "Tile: $1,200" — the words before a colon right in front of the
   *  amount (back to the previous item break); "" otherwise. */
  colonLabel: string;
}

/** Every money amount in the sentence, in order, each counted once. */
function scanAmounts(raw: string): Amount[] {
  const found: { cents: number; start: number; end: number }[] = [];

  const dollarRe = /\$\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g;
  for (const m of raw.matchAll(dollarRe)) {
    found.push({
      cents: toCents(m[1], m[2]),
      start: m.index!,
      end: m.index! + m[0].length,
    });
  }

  const wordRe =
    /(?<![\d.,$])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s+(\p{L}+)/gu;
  for (const m of raw.matchAll(wordRe)) {
    if (!CURRENCY_WORDS.test(m[3])) continue;
    const start = m.index!;
    // "$3700 dollars" is the $ amount again, not a second one.
    if (found.some((f) => start >= f.start && start < f.end)) continue;
    found.push({ cents: toCents(m[1], m[2]), start, end: start + m[0].length });
  }

  found.sort((a, b) => a.start - b.start);
  return found.map((f, i) => {
    const prevEnd = i > 0 ? found[i - 1].end : 0;
    const nextStart = i + 1 < found.length ? found[i + 1].start : raw.length;
    const gapBefore = raw.slice(prevEnd, f.start);
    const breakAt = Math.max(
      ...[",", ";", ":", "\n"].map((c) => gapBefore.lastIndexOf(c)),
    );
    const before = breakAt >= 0 ? gapBefore.slice(breakAt + 1) : gapBefore;
    let colonLabel = "";
    if (breakAt >= 0 && gapBefore[breakAt] === ":" && !before.trim()) {
      const head = gapBefore.slice(0, breakAt);
      const prevBreak = Math.max(
        ...[",", ";", ":", "\n"].map((c) => head.lastIndexOf(c)),
      );
      colonLabel = head.slice(prevBreak + 1);
    }
    const gapAfter = raw.slice(f.end, nextStart);
    const cut = gapAfter.search(ITEM_BREAK);
    const after = cut >= 0 ? gapAfter.slice(0, cut) : gapAfter;
    return { ...f, before, after, colonLabel };
  });
}

const hasWord = (a: Amount, re: RegExp) =>
  re.test(a.before) || re.test(a.after);

/** True when two amounts are alternatives ("$3,000 to $4,000"). */
function isRange(raw: string, amounts: Amount[]): boolean {
  for (let i = 1; i < amounts.length; i++) {
    if (RANGE_GAP.test(raw.slice(amounts[i - 1].end, amounts[i].start))) {
      return true;
    }
  }
  return false;
}

/** Strip list marks and filler from a label; capitalise it. */
function cleanLabel(s: string): string {
  const t = s
    .replace(/^[\s\-–—•*·.]+/, "")
    .replace(/[\s\-–—=:.]+$/, "")
    .replace(/\s+(for|para|de|por|at|is|es)$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}

/**
 * The price in the sentence, INTEGER CENTS:
 *   - "$3,700" → 370000; "$1,850.50" → 185050; "$3700" → 370000;
 *   - "3700 dólares" (number + currency word) → 370000;
 *   - bare numbers/dimensions (20x15, 6 paneles) are never a price;
 *   - an amount marked "total" / "todo incluido" wins;
 *   - amounts marked as a deposit ("deposit", "down", "anticipo", "%") are
 *     part of the price, never added: the largest of the others wins;
 *   - a range ("$3,000 to $4,000") → the largest;
 *   - otherwise several amounts are an itemised list → their SUM (REQ-259:
 *     "demo $2,500, cabinets $8,000, quartz $4,200" is $14,700, not $8,000);
 *   - none / zero → null.
 */
export function extractPriceCents(raw: string): number | null {
  const amounts = scanAmounts(raw).filter((a) => a.cents > 0);
  if (amounts.length === 0) return null;
  const max = (xs: Amount[]) => Math.max(...xs.map((a) => a.cents));

  const totals = amounts.filter((a) => hasWord(a, TOTAL_WORD));
  if (totals.length > 0) return max(totals);

  const deposits = amounts.filter((a) => hasWord(a, DEPOSIT_WORD));
  if (deposits.length > 0) {
    const rest = amounts.filter((a) => !deposits.includes(a));
    return rest.length > 0 ? max(rest) : max(deposits);
  }

  if (amounts.length === 1 || isRange(raw, amounts)) return max(amounts);
  return amounts.reduce((sum, a) => sum + a.cents, 0);
}

/**
 * REQ-259: the priced lines of an itemised sentence — each amount with the
 * words naming it (before it, else after it, within its own item):
 *   "demo $2,500, cabinets $8,000" → [{Demo, 250000}, {Cabinets, 800000}].
 * [] when the sentence is not a list of labelled items: one amount, a total,
 * a deposit, a range, or any amount without a label.
 */
export function extractPriceLines(raw: string): PriceLine[] {
  const amounts = scanAmounts(raw).filter((a) => a.cents > 0);
  if (amounts.length < 2) return [];
  if (amounts.some((a) => hasWord(a, TOTAL_WORD) || hasWord(a, DEPOSIT_WORD))) {
    return [];
  }
  if (isRange(raw, amounts)) return [];
  const lines: PriceLine[] = [];
  for (const a of amounts) {
    const label = cleanLabel(a.before) || cleanLabel(a.after) ||
      cleanLabel(a.colonLabel);
    if (!label) return [];
    lines.push({ label, cents: a.cents });
  }
  return lines;
}

/** A quote line item as POST /quotes takes it. */
export interface PrefillLineItem {
  description: string;
  quantity: number;
  unit: string;
  price: number;
}

/**
 * REQ-259: the line items of a quote started from typed details. The typed
 * lines are kept when they still add up to the price the user confirmed on
 * the picker; a changed price (or no lines) is one summary line at that price.
 */
export function quoteLineItemsFromPrefill(
  lines: PriceLine[] | null | undefined,
  cents: number,
  summary: string,
): PrefillLineItem[] {
  const list = lines ?? [];
  const sum = list.reduce((s, l) => s + l.cents, 0);
  if (list.length >= 2 && sum === cents) {
    return list.map((l) => ({
      description: l.label,
      quantity: 1,
      unit: "ea",
      price: l.cents,
    }));
  }
  return [{ description: summary, quantity: 1, unit: "ea", price: cents }];
}

/** A run token: Capitalized Unicode-letter word (apostrophes/hyphens ok). */
const CAP_TOKEN = /^[\p{Lu}][\p{L}'’-]*$/u;
/** REQ-331: a lowercase word that can only be a name after "customer" /
 *  "cliente" ("quote for customer x") — letters only, never a filler word. */
const LOWER_NAME_TOKEN = /^[\p{Ll}][\p{L}'’-]*$/u;
const NOT_A_NAME =
  /^(?:who|that|which|de|del|en|con|y|o|a|the|and|or|in|at|on|with|for|para|que|is|es|named|llamado|llamada)$/i;

/**
 * The "para/for <Name>" customer candidate:
 *   - the run of Capitalized tokens after "para"/"for" (+ optional article
 *     el/la/los/las/the); the run stops at a comma, a digit, a "$" or a
 *     lowercase token;
 *   - REQ-331 (demo m7/m44): a lowercase connector or honorific between
 *     the lead and the name is skipped — "for customer Maria Lopez", "para
 *     el cliente Juan", "para la señora López", "for Mrs. Henderson" — and
 *     "this is <Name>" / "es para <Name>" also name the customer; right
 *     after "customer"/"cliente" a single lowercase word is the name too
 *     ("quote for customer x" → "X");
 *   - ES household form: "para la familia Nguyen" → "Familia Nguyen";
 *   - EN postfix form: "for the Smith family" → "Smith family";
 *   - REQ-386 (demo m17): a full name elsewhere in the message that shares
 *     a word with a surname / household lead-in wins over it — "for the
 *     Gutierrez family. Maria Gutierrez, …" → "Maria Gutierrez", "para
 *     Okafor (Daniel Okafor)" → "Daniel Okafor";
 *   - REQ-386: with no lead-in, "<Name> wants / needs / asked …" (ES
 *     "quiere / necesita / pidió") names the customer — "Bob wants 6
 *     recessed lights" → "Bob";
 *   - no phrase → null (never a hallucinated name).
 */
export function extractCustomerName(raw: string): string | null {
  const lead = leadInName(raw);
  if (lead) return fullNameFor(raw, lead) ?? lead;
  return subjectName(raw);
}

/** Words that read as a household / honorific / pronoun, never a name. */
const NAME_STOP =
  /^(?:family|familia|the|el|la|los|las|mr|mrs|ms|miss|dr|sr|sra|srta|se[ñn]ora?|don|do[ñn]a|i|he|she|they|we|you|it|this|that|my|our|his|her|their|your|ella|[ée]l|ellos|ellas|mi|su|nosotros|customer|client|cliente|clienta|someone|somebody|everyone|alguien)$/i;

/** REQ-386 (demo m17): every run of two to four Capitalized words in the
 *  text — "(Daniel Okafor)", "Maria Gutierrez," — a run ends at punctuation
 *  or at a household / honorific / pronoun word. */
function fullNameRuns(raw: string): string[][] {
  const runs: string[][] = [];
  let run: string[] = [];
  const close = () => {
    if (run.length >= 2 && run.length <= 4) runs.push(run);
    run = [];
  };
  for (const piece of raw.split(/\s+/)) {
    if (/^[(\["“'‘]/.test(piece)) close();
    const tok = piece.replace(/^[(\["“'‘]+/, "").replace(
      /[)\]"”’,;:.!?]+$/,
      "",
    );
    if (!tok || !CAP_TOKEN.test(tok) || NAME_STOP.test(tok)) {
      close();
      continue;
    }
    run.push(tok);
    if (tok !== piece.replace(/^[(\["“'‘]+/, "")) close();
  }
  close();
  return runs;
}

const foldWord = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * REQ-386 (demo m17): a lead-in that only caught a surname or a household
 * ("for the Gutierrez family", "para Okafor") gives way to a full name in
 * the same message that shares one of its words ("Maria Gutierrez",
 * "(Daniel Okafor)"). An unrelated Capitalized pair never wins.
 */
function fullNameFor(raw: string, lead: string): string | null {
  const leadWords = lead.split(/\s+/).filter((w) => !NAME_STOP.test(w))
    .map(foldWord);
  if (leadWords.length === 0) return null;
  for (const run of fullNameRuns(raw)) {
    if (run.length <= leadWords.length) continue;
    if (run.some((w) => leadWords.includes(foldWord(w)))) return run.join(" ");
  }
  return null;
}

/** "<Name> wants / needs / asked …" and the ES "<Name> quiere / necesita". */
const SUBJECT_VERB =
  /\s(?:wants|wanted|needs|needed|asked|asks|is\s+asking|is\s+looking|would\s+like|quiere|quer[ií]a|necesita|pidi[oó]|pide)\b/giu;

/**
 * REQ-386 (demo m17): with no lead-in, the Capitalized words right before a
 * "wants / needs / asked" verb are the customer — "Need a quote: Bob wants 6
 * recessed lights" → "Bob". A pronoun or a lowercase word there ("I need",
 * "The kitchen needs") is never a name.
 */
function subjectName(raw: string): string | null {
  for (const m of raw.matchAll(SUBJECT_VERB)) {
    const before = raw.slice(0, m.index!).split(/\s+/);
    const run: string[] = [];
    for (let i = before.length - 1; i >= 0 && run.length < 4; i--) {
      const piece = before[i];
      if (/[,;:.!?)]$/.test(piece) && run.length > 0) break;
      const tok = piece.replace(/^[(\["“'‘]+/, "");
      if (!CAP_TOKEN.test(tok) || NAME_STOP.test(tok)) break;
      run.unshift(tok);
      if (tok !== piece) break;
    }
    if (run.length > 0) return run.join(" ");
  }
  return null;
}

/** The "this is / for / para <Name>" lead-in candidate (UX-04, REQ-331). */
function leadInName(raw: string): string | null {
  const lead =
    /\b(?:this\s+is|para|for)\s+(?:(?:el|la|los|las|the|un|una|a)\s+)?(?:(?<conn>cliente|clienta|customer|client)\s+|(?:se[ñn]ora?|srt?a\.?|sr\.?|don|do[ñn]a|mr\.?|mrs\.?|ms\.?|miss|dr\.?)\s+)?/giu;
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
        } else if (
          run.length === 0 && m.groups?.conn && LOWER_NAME_TOKEN.test(tok) &&
          !NOT_A_NAME.test(tok)
        ) {
          // "for customer x" — the word after the connector IS the name.
          run.push(tok[0].toUpperCase() + tok.slice(1));
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
  if (m) {
    const out = `${m[1]} ${m[2]}${m[3]}`.replace(/\s+/g, " ").trim();
    // "…Lake Avenue. Total $900" — a full street word then a period ends it.
    if (m[0].endsWith(".") && !STREET_ABBREV.test(m[3])) return out;
    return out + cityTail(raw.slice(m.index + m[0].length)).text;
  }
  // REQ-331 (demo m7 / M21): the ES street-first form — "calle Elm 512",
  // "avenida Reforma 100" — street word, one to four name words, the number.
  const es = new RegExp(
    `\\b(calle|avenida|av\\.?|carrera|carretera|camino|paseo|bulevar|boulevard)\\s+((?:[\\p{Lu}\\d][\\p{L}\\d'’.-]*\\s+){1,4}?)(\\d{1,6}[A-Za-z]?)(?=[\\s,;:]|$)`,
    "iu",
  );
  const e = es.exec(raw);
  if (e) {
    const word = e[1][0].toUpperCase() + e[1].slice(1).toLowerCase();
    const out = `${word} ${e[2]}${e[3]}`.replace(/\s+/g, " ").trim();
    return out + cityTail(raw.slice(e.index + e[0].length)).text;
  }
  // REQ-331: the number-less "on <Street> <St> … <ZIP>" form — only when a
  // ZIP closes it, so "on Monday" or "on the roof" are never an address.
  const bare = new RegExp(
    `\\bon\\s+((?:[\\p{Lu}][\\p{L}'’.-]*\\s+){1,4}?)(${STREET_SUFFIX})\\.?(?=[\\s,;:]|$)`,
    "u",
  );
  const b = bare.exec(raw);
  if (b) {
    const tail = cityTail(raw.slice(b.index + b[0].length));
    if (tail.zip) {
      return `${b[1]}${b[2]}`.replace(/\s+/g, " ").trim() + tail.text;
    }
  }
  // REQ-386 (demo m17): no street, but the place is still typed — "Austin,
  // TX 78745" keeps city / state / ZIP; "zip 78745" / "código postal 78745"
  // keeps the ZIP, so the address box starts with it instead of empty. A
  // bare 5-digit number with neither is never taken for a ZIP.
  const cityState =
    /(?:([\p{Lu}][\p{L}'’-]*(?:\s+[\p{Lu}][\p{L}'’-]*){0,2})(,?)\s+)?\b([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\b/u
      .exec(raw);
  if (cityState) {
    const [, city, comma, state, zip] = cityState;
    return city ? `${city}${comma} ${state} ${zip}` : `${state} ${zip}`;
  }
  const zip =
    /\b(?:zip(?:\s*code)?|c[oó]digo\s+postal|c\.p\.?|cp)\s*[:#]?\s*(\d{5}(?:-\d{4})?)\b/iu
      .exec(raw);
  if (zip) return zip[1];
  return null;
}

/** City / state / ZIP after the street: Capitalized words, a 2-letter
 *  state, a 5(+4)-digit ZIP, separated by spaces or single commas. */
function cityTail(rest: string): { text: string; zip: boolean } {
  const tail = /^(\s*,?\s*)([\p{Lu}][\p{L}'’-]*|\d{5}(?:-\d{4})?)/u;
  let cursor = rest;
  let text = "";
  let words = 0;
  for (;;) {
    const t = tail.exec(cursor);
    if (!t || words >= 5) break;
    text += `${t[1].includes(",") ? ", " : " "}${t[2]}`;
    cursor = cursor.slice(t[0].length);
    words++;
    if (/^\d/.test(t[2])) return { text, zip: true }; // the ZIP closes it
  }
  return { text, zip: false };
}

/** All the deterministic facts in one call. */
export function extractQuickQuotePrefill(raw: string): QuickQuotePrefill {
  return {
    priceCents: extractPriceCents(raw),
    customerName: extractCustomerName(raw),
    serviceAddress: extractServiceAddress(raw),
    lines: extractPriceLines(raw),
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
