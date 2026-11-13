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

/** Resolve the language a public page should render in, from RAW headers.
 *  REQ-272: an explicit ?lang= on the link (the visitor's EN | ES pick on
 *  /i and /co) beats everything else, exactly as on /q (REQ-048). */
export function resolvePublicLang(args: {
  /** The link's ?lang= query value, raw. */
  query?: string | null;
  /** The RAW Cookie request header. */
  cookie?: string | null;
  /** The document's generation language (contractor.commsLanguage). */
  docLang?: string;
  /** The Accept-Language request header. */
  header?: string | null;
}): PublicLang {
  if (args.query === "en" || args.query === "es") return args.query;
  return resolvePublicLangFrom({
    cookieLang: pmLangFromCookie(args.cookie),
    docLang: args.docLang,
    headerLang: pmLangFromAcceptLanguage(args.header),
  });
}

/**
 * REQ-048: the public CONTRACT (/q/:id) is English first. Only a choice the
 * visitor made themselves changes that — an explicit ?lang= on the link,
 * then their persisted pm_lang pick. The contractor's outgoing-comms
 * language is deliberately NOT an input: the customer flips the document
 * with the page's own EN | ES toggle, in place, whenever they like.
 */
export function resolveContractLang(parts: {
  /** The link's ?lang= query value, raw. */
  query?: string | null;
  /** The RAW Cookie request header. */
  cookie?: string | null;
}): PublicLang {
  if (parts.query === "en" || parts.query === "es") return parts.query;
  return pmLangFromCookie(parts.cookie) ?? "en";
}

/**
 * REQ-715 (demo-loop cycle 5, m31): did the /q visitor choose a language — an
 * explicit ?lang= on the link, or their own pm_lang pick? Only then does the
 * contract keep the language it opened in (REQ-048); otherwise it opens in
 * the customer's own language once the quote is loaded (contractLangOnLoad).
 */
export function contractLangChosen(parts: {
  /** The link's ?lang= query value, raw. */
  query?: string | null;
  /** The RAW Cookie request header. */
  cookie?: string | null;
}): boolean {
  return parts.query === "en" || parts.query === "es" ||
    pmLangFromCookie(parts.cookie) !== null;
}

/**
 * REQ-715 (m31): the language /q shows once the quote is loaded. A visitor
 * who chose (`chosen`: ?lang= or pm_lang — or a tap on the page's EN | ES
 * toggle) keeps the language it opened in; else the language the contractor
 * recorded for this customer (the public quote's `docLang`); else the one it
 * opened in — English first (REQ-048).
 */
export function contractLangOnLoad(parts: {
  opened: PublicLang;
  chosen: boolean;
  /** The customer's own language (the public quote's `docLang`). */
  docLang?: string | null;
}): PublicLang {
  if (parts.chosen) return parts.opened;
  return parts.docLang === "en" || parts.docLang === "es"
    ? parts.docLang
    : parts.opened;
}

/**
 * REQ-272: the href of a public page's EN | ES toggle link — the same page
 * (path + every other query param) with ?lang= set to `lang`. Same-origin
 * and relative, so it can never point at another site.
 */
export function langToggleHref(currentUrl: string, lang: PublicLang): string {
  const url = new URL(currentUrl);
  url.searchParams.set("lang", lang);
  return `${url.pathname}${url.search}`;
}

/**
 * REQ-492 (demo-loop cycle 3, M29): a hand-off link from one public page to
 * another (the signed quote's "Pay now" → /i, Related documents → /i and
 * /co) carries the language the reader is looking at. /q is English first
 * (resolveContractLang) while /i and /co fall back to the contractor's
 * commsLanguage, so a link without ?lang= could flip the reader's language
 * mid-flow. Keeps every other query param and the hash; a relative link
 * stays relative, an absolute one absolute.
 */
export function withLang(href: string, lang: PublicLang): string {
  const absolute = /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//");
  const url = new URL(href, "http://relative.invalid");
  url.searchParams.set("lang", lang);
  return absolute ? url.href : `${url.pathname}${url.search}${url.hash}`;
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
