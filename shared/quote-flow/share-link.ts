/**
 * Quote share links (raw-plan p11): Copy Link hands the customer the SAME
 * full quote document that "View as client" shows — the short /s/<code>
 * link exists for SMS friendliness and resolves to the full /q/<id> view.
 *
 * REQ-342 (demo-loop cycle 1, M13): every link a customer receives may carry
 * the language it was sent in as `?lang=` — the one input REQ-048's
 * English-first /q page honors ahead of its cookie — so a cookie-less
 * visitor opens the document in the language it was previewed and sent in.
 * No language → the link is unchanged.
 */

export interface QuoteRef {
  id: string;
  shortCode?: string;
}

export type SendLang = "en" | "es";

/** Appends `?lang=<lang>` when lang is a public language; otherwise returns
 *  the path untouched. */
export function withSendLang(url: string, lang?: string | null): string {
  if (lang !== "en" && lang !== "es") return url;
  return `${url}${url.includes("?") ? "&" : "?"}lang=${lang}`;
}

export function quoteShareLink(
  quote: QuoteRef,
  base: string,
  lang?: SendLang,
): string {
  const path = quote.shortCode
    ? `${base}/s/${quote.shortCode}`
    : `${base}/q/${quote.id}`;
  return withSendLang(path, lang);
}

export function quoteClientViewLink(
  quote: QuoteRef,
  base: string,
  lang?: SendLang,
): string {
  return withSendLang(`${base}/q/${quote.id}`, lang);
}

/** Where the share link lands after the short-code redirect; the link's
 *  `?lang=` (raw query value) is forwarded onto the document. */
export function resolveShareTarget(
  quote: QuoteRef,
  lang?: string | null,
): string {
  return withSendLang(`/q/${quote.id}`, lang);
}

/** REQ-586 (demo-loop cycle 4, M11): a public language, or nothing. */
function publicLang(v: unknown): SendLang | undefined {
  return v === "en" || v === "es" ? v : undefined;
}

/**
 * REQ-586 (demo-loop cycle 4, M11): the language a quote last went out in
 * (SendQuote records it on `lastDelivery.lang`). Every in-app customer link
 * — the chat's "Open as customer" / "Copy", the /quotes panel and card —
 * carries it as `?lang=`, so a cookie-less customer opens the document in
 * the language it was sent in. Nothing recorded → undefined (link unchanged).
 */
export function quoteSendLang(
  q: { lastDelivery?: { lang?: string | null } | null } | null | undefined,
): SendLang | undefined {
  return publicLang(q?.lastDelivery?.lang);
}

/**
 * REQ-586 (demo-loop cycle 4, M11): an invoice's document language — its
 * own `lang` (a standalone invoice, REQ-497), else the language its quote
 * was sent in, else the quote's base language. /i reads it ahead of the
 * contractor's default commsLanguage.
 *
 * REQ-715 (demo-loop cycle 5, m31): the customer's own language
 * (Customer.language) comes first — the reader's language, the one every
 * send to them resolves to when no language is picked.
 */
export function invoiceDocLang(
  inv: { lang?: string | null } | null | undefined,
  quote?:
    | {
      lang?: string | null;
      lastDelivery?: { lang?: string | null } | null;
    }
    | null,
  customer?: { language?: string | null } | null,
): SendLang | undefined {
  return publicLang(customer?.language) ?? publicLang(inv?.lang) ??
    quoteSendLang(quote) ?? publicLang(quote?.lang);
}
