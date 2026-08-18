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

/** Parse the pm_lang choice out of a RAW Cookie header — null when absent. */
export function pmLangFromCookie(
  cookie?: string | null,
): PublicLang | null {
  // Accept "," as a separator too: over HTTP/2 each cookie arrives in its
  // own header field, which Deno re-joins with ", " (langFromCookie parity).
  const m = cookie?.match(/(?:^|[;,]\s*)pm_lang=(en|es)(?:[;,]|$)/);
  return m ? (m[1] as PublicLang) : null;
}

/** Narrow the leading Accept-Language tag to a PublicLang — null when it is
 *  neither an "es" nor an "en" tag. */
export function pmLangFromAcceptLanguage(
  header?: string | null,
): PublicLang | null {
  const firstTag = header?.split(",")[0]?.trim() ?? "";
  if (/^es\b/i.test(firstTag)) return "es";
  if (/^en\b/i.test(firstTag)) return "en";
  return null;
}

/**
 * The ONE precedence table, over ALREADY-PARSED values.
 *
 * Public documents are rendered by a mix of SSR routes (which hold the raw
 * request headers) and client islands (which can only be handed serializable
 * props — never the raw Cookie header, which carries the session). Both go
 * through this function so /q, /c, /i and /co can never drift apart.
 */
export function resolvePublicLangFrom(parts: {
  /** The visitor's persisted pm_lang CHOICE, already parsed. */
  cookieLang?: PublicLang | null;
  /** The document's generation language (contractor.commsLanguage). */
  docLang?: string | null;
  /** The browser's preferred language, already parsed. */
  headerLang?: PublicLang | null;
}): PublicLang {
  if (parts.cookieLang === "en" || parts.cookieLang === "es") {
    return parts.cookieLang;
  }
  if (parts.docLang === "es" || parts.docLang === "en") return parts.docLang;
  if (parts.headerLang === "es" || parts.headerLang === "en") {
    return parts.headerLang;
  }
  return "en";
}

/** Resolve the language a public page should render in, from RAW headers. */
export function resolvePublicLang(args: {
  /** The RAW Cookie request header. */
  cookie?: string | null;
  /** The document's generation language (contractor.commsLanguage). */
  docLang?: string;
  /** The Accept-Language request header. */
  header?: string | null;
}): PublicLang {
  return resolvePublicLangFrom({
    cookieLang: pmLangFromCookie(args.cookie),
    docLang: args.docLang,
    headerLang: pmLangFromAcceptLanguage(args.header),
  });
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
