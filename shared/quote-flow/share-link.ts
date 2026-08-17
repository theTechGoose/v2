/**
 * Quote share links (raw-plan p11): Copy Link hands the customer the SAME
 * full quote document that "View as client" shows — the short /s/<code>
 * link exists for SMS friendliness and resolves to the full /q/<id> view.
 */

export interface QuoteRef {
  id: string;
  shortCode?: string;
}

export function quoteShareLink(quote: QuoteRef, base: string): string {
  return quote.shortCode ? `${base}/s/${quote.shortCode}` : `${base}/q/${quote.id}`;
}

export function quoteClientViewLink(quote: QuoteRef, base: string): string {
  return `${base}/q/${quote.id}`;
}

/** Where the share link lands after the short-code redirect. */
export function resolveShareTarget(quote: QuoteRef): string {
  return `/q/${quote.id}`;
}
