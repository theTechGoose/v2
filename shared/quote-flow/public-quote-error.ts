/**
 * REQ-574 (demo-loop cycle 4, p4-p9b): the public quote page (/q/<id>) says
 * what actually went wrong instead of one "expired or revoked" for every
 * failure.
 *
 *   - 410 (gone: the link was revoked / expired) → linkExpired
 *   - a network failure (no response) or a 5xx  → loadFailed (+ Retry)
 *   - any other non-OK, incl. 404 not_found (a truncated or unknown id)
 *                                                → notFound
 */
export type PublicQuoteError = "notFound" | "linkExpired" | "loadFailed";

/** Classify a failed /quotes/:id/public load. `status` is null when the
 *  fetch itself failed (offline, DNS, aborted). */
export function publicQuoteErrorOf(status: number | null): PublicQuoteError {
  if (status === null || status >= 500) return "loadFailed";
  if (status === 410) return "linkExpired";
  return "notFound";
}

/** The lang/*.json key that explains `error` to the visitor. */
export function publicQuoteErrorKey(error: PublicQuoteError): string {
  return `publicQuote.${error}`;
}
