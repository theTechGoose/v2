/**
 * Outbound-email i18n formatting (P-07 / P-28 / P-29 / P-44 / P-51).
 *
 * Pure logic, shared between the Deno backend and the jest unit suite —
 * no side effects, no runtime JSON loading. The small literal string maps
 * below are copies of lang/en.json + lang/es.json values (key named at each
 * map) and MUST be kept in sync with the dictionaries.
 *
 * Wire-in targets (backend agent):
 *  - titleCaseJobName → send-paperwork-email/mod.ts:638, :1026 (replaces the
 *    non-Unicode `replace(/\b\w/g, …)` that mangles accented names).
 *  - fmtPaperworkDate → send-paperwork-email/mod.ts:372-387 (fmtDate).
 *  - invoiceStatusLabel → send-paperwork-email/mod.ts:1375 (raw enum row).
 *  - unitLabel → send-paperwork-email/mod.ts:653, :1060 (`li.unit ?? "ea"`).
 *  - buildLocalizedQuoteEmailSubject → renderQuoteSubject,
 *    send-paperwork-email/mod.ts:513-538.
 */

/** Spanish stopwords that stay lowercase mid-title (never as the first word). */
const ES_TITLE_STOPWORDS = new Set(["de", "y", "en", "para", "la", "el"]);

function localeOf(lang: string): string {
  return lang === "es" ? "es" : "en-US";
}

/**
 * Unicode-aware title-casing for the email hero. Only the FIRST letter of
 * each word is uppercased (the broken `\b\w` approach fires again after
 * accented characters: "InstalacióN De BañO"). For "es", common stopwords
 * stay lowercase when they are not the first word.
 */
export function titleCaseJobName(name: string, lang: string): string {
  const locale = localeOf(lang);
  return name
    .trim()
    .split(/\s+/)
    .map((word, i) => {
      const lower = word.toLocaleLowerCase(locale);
      if (lang === "es" && i > 0 && ES_TITLE_STOPWORDS.has(lower)) {
        return lower;
      }
      return word.charAt(0).toLocaleUpperCase(locale) + word.slice(1);
    })
    .join(" ");
}

/**
 * Locale + timezone aware document date.
 *
 * - Date-only input (YYYY-MM-DD) keeps its calendar day in EVERY timezone
 *   (anchored to noon UTC and rendered as UTC).
 * - Full timestamps render in `tz` when given, else the system local
 *   timezone — never pinned to UTC (no off-by-one across midnight).
 * - "es" renders Spanish long dates ("20 de agosto de 2026"); "en" keeps
 *   the en-US long format ("August 20, 2026"). Never returns raw ISO for a
 *   parseable input.
 */
export function fmtPaperworkDate(
  iso: string,
  lang: string,
  tz?: string,
): string {
  if (!iso) return "—";
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const d = new Date(isDateOnly ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(+d)) return iso;
  return new Intl.DateTimeFormat(localeOf(lang), {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: isDateOnly ? "UTC" : tz,
  }).format(d);
}

/** Keep in sync with lang/en.json + lang/es.json "status.*" family. */
const STATUS_LABELS: Record<string, Record<string, string>> = {
  en: {
    accepted: "Accepted",
    declined: "Declined",
    draft: "Draft",
    overdue: "Overdue",
    paid: "Paid",
    sent: "Sent",
    signed: "Signed",
    viewed: "Viewed",
  },
  es: {
    accepted: "Aceptada",
    declined: "Rechazada",
    draft: "Borrador",
    overdue: "Vencida",
    paid: "Pagado",
    sent: "Enviado",
    signed: "Firmado",
    viewed: "Visto",
  },
};

/**
 * Localized label for the invoice email "Estado" row — never the raw enum.
 * Unknown statuses still yield a non-empty, capitalized label.
 */
export function invoiceStatusLabel(status: string, lang: string): string {
  const key = status.trim().toLowerCase();
  const table = STATUS_LABELS[lang === "es" ? "es" : "en"];
  const hit = table[key];
  if (hit) return hit;
  const raw = status.trim() || "—";
  return raw.charAt(0).toLocaleUpperCase(localeOf(lang)) + raw.slice(1);
}

/** Keep in sync with lang/en.json + lang/es.json "quoteDoc.unitEach". */
const UNIT_EACH: Record<string, string> = { en: "ea", es: "c/u" };

/**
 * Localizes the per-line unit. The "ea"/"each" unit (and the missing-unit
 * fallback `li.unit ?? "ea"`) maps to the dict's quoteDoc.unitEach;
 * unknown/custom units pass through unchanged.
 */
export function unitLabel(unit: string | undefined, lang: string): string {
  const u = (unit ?? "").trim().toLowerCase();
  if (u === "" || u === "ea" || u === "each") {
    return UNIT_EACH[lang === "es" ? "es" : "en"];
  }
  return unit as string;
}

/**
 * Quote email subject templates.
 * Keep "en" in sync with lang/en.json "paperworkEmail.quote.subject".
 * "es" is the FIXED word order (P-44) — lang/es.json still carries the old
 * "{businessName} Cotización para …" and must be updated to match this.
 */
const QUOTE_SUBJECT_TEMPLATES: Record<string, string> = {
  en: "{businessName} Quote for {customerName}, {jobName}",
  es: "Cotización de {businessName} para {customerName}, {jobName}",
};

/**
 * lang/businessName-aware sibling of buildQuoteEmailSubject (email-subject.ts,
 * untouched). Spanish leads with "Cotización de {businessName} para …" —
 * never the English word order.
 */
export function buildLocalizedQuoteEmailSubject(
  args: { businessName: string; customerName: string; jobName: string },
  lang: string,
): string {
  const template = QUOTE_SUBJECT_TEMPLATES[lang === "es" ? "es" : "en"];
  return template
    .replace("{businessName}", args.businessName)
    .replace("{customerName}", args.customerName)
    .replace("{jobName}", args.jobName);
}
