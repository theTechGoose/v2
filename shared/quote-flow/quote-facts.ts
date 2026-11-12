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

export type PrefillPaymentTerms =
  | "50_50"
  | "30_30_40"
  | "deposit_bal"
  | "net_15";

export interface QuoteFacts {
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  /** The typed START date — `iso` YYYY-MM-DD, `us` MM/DD/YYYY (the value the
   *  wizard's date picker submits). */
  startDate: { iso: string; us: string } | null;
  paymentTerms: PrefillPaymentTerms | null;
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
/** Filler allowed between the keyword and the date. */
const FILLER =
  /^(?:\s|,|:|\bon\b|\bthe\b|\bdate\b|\bel\b|\bdía\b|\bdia\b|\bdel\b|\ba partir\b)*/iu;

const pad = (n: number) => String(n).padStart(2, "0");

function resolve(
  month: number,
  day: number,
  year: number | null,
  today: Date,
): { iso: string; us: string } | null {
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

/** Parse a date at the very start of `s` (after the start keyword). */
function parseDateAt(
  s: string,
  today: Date,
): { iso: string; us: string } | null {
  const t = s.replace(FILLER, "");
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

/** The START date the text states — only a date tied to a start word. */
export function extractStartDate(
  raw: string,
  today: Date,
): { iso: string; us: string } | null {
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

/** The payment schedule the text states, mapped onto the wizard's options. */
export function extractPaymentTerms(raw: string): PrefillPaymentTerms | null {
  const s = raw.toLowerCase();
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

/** Every fact in one call. `today` anchors a year-less start date. */
export function extractQuoteFacts(raw: string, today: Date): QuoteFacts {
  const text = raw ?? "";
  return {
    customerName: extractCustomerName(text),
    customerPhone: extractPhone(text),
    customerEmail: extractEmail(text),
    startDate: extractStartDate(text, today),
    paymentTerms: extractPaymentTerms(text),
  };
}

export interface WizardPrefill {
  optionId: string;
  customValue?: string;
}

/** The wizard step's pre-selection from the facts; null when the text said
 *  nothing about that step. */
export function wizardPrefillFor(
  stepId: string | undefined,
  facts: QuoteFacts,
): WizardPrefill | null {
  if (stepId === "start_date" && facts.startDate) {
    return { optionId: "custom", customValue: facts.startDate.us };
  }
  if (stepId === "payment_terms" && facts.paymentTerms) {
    return { optionId: facts.paymentTerms };
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
