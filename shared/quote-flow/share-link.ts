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
