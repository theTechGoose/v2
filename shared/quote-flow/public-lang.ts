/**
 * Public money-page localization (P-12): /i and /co must honor the
 * visitor's pm_lang cookie before the document's generation language.
 *
 * Precedence — the visitor's own choice always wins:
 *   1. pm_lang cookie (parsed like front-end/lib/lang.ts langFromCookie,
 *      surviving HTTP/2 comma-joined Cookie headers)
 *   2. the document's language (contractor.commsLanguage)
 *   3. the Accept-Language header (a leading "es" tag → "es")
 *   4. "en"
 *
 * The ES chrome labels below are the exact values already shipped in
 * lang/es.json (publicInvoice.* / publicInvoiceClaim.* /
 * publicChangeOrderActions.approve) — no new lang keys.
 */

export type PublicLang = "en" | "es";

/** Resolve the language a public money page should render in. */
export function resolvePublicLang(args: {
  /** The RAW Cookie request header. */
  cookie?: string | null;
  /** The document's generation language (contractor.commsLanguage). */
  docLang?: string;
  /** The Accept-Language request header. */
  header?: string | null;
}): PublicLang {
  // Accept "," as a separator too: over HTTP/2 each cookie arrives in its
  // own header field, which Deno re-joins with ", " (langFromCookie parity).
  const m = args.cookie?.match(/(?:^|[;,]\s*)pm_lang=(en|es)(?:[;,]|$)/);
  if (m) return m[1] as PublicLang;

  if (args.docLang === "es" || args.docLang === "en") return args.docLang;

  const firstTag = args.header?.split(",")[0]?.trim() ?? "";
  if (/^es\b/i.test(firstTag)) return "es";

  return "en";
}

export interface MoneyPageStrings {
  billTo: string;
  amountDue: string;
  howToPay: string;
  iSentIt: string;
  approveChange: string;
}

const MONEY_PAGE_STRINGS: Record<PublicLang, MoneyPageStrings> = {
  en: {
    billTo: "Bill to",
    amountDue: "Amount due",
    howToPay: "How would you like to pay?",
    iSentIt: "I sent it",
    approveChange: "Approve this change",
  },
  es: {
    billTo: "Facturar a",
    amountDue: "Monto a pagar",
    howToPay: "¿Cómo quieres pagar?",
    iSentIt: "Ya lo envié",
    approveChange: "Aprobar este cambio",
  },
};

/** The localized /i + /co chrome labels. */
export function moneyPageStrings(lang: PublicLang): MoneyPageStrings {
  return MONEY_PAGE_STRINGS[lang];
}
