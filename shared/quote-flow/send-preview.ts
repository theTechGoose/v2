/**
 * REQ-461 (demo-loop cycle 3, m8) — the send dialog's "What they'll get":
 * GET /quotes/:id/send-preview renders the quote's email (subject + body)
 * and text in the picked send language without sending. Shared by the
 * backend route (query parsing) and the front-end client (path + sections).
 *
 * Pure logic, no side effects.
 */

export type SendPreviewChannel = "email" | "sms" | "both";
export type SendPreviewLang = "en" | "es";

/** What GET /quotes/:id/send-preview answers. A part is present only when
 *  the channel sends it; `needsName` when the account has no name to
 *  introduce itself with (the send itself would refuse — P-06 / UX-26). */
export interface QuoteSendPreview {
  lang: SendPreviewLang;
  email?: { to?: string; subject: string; html: string };
  sms?: { to?: string; body: string };
  needsName?: boolean;
}

export function sendPreviewPath(
  quoteId: string,
  channel: SendPreviewChannel,
  lang: SendPreviewLang,
): string {
  return `/quotes/${
    encodeURIComponent(quoteId)
  }/send-preview?channel=${channel}&lang=${lang}`;
}

export function sendPreviewSections(
  channel: SendPreviewChannel,
): { email: boolean; sms: boolean } {
  return {
    email: channel === "email" || channel === "both",
    sms: channel === "sms" || channel === "both",
  };
}

/** The route's query, read safely: an unknown channel previews both; an
 *  unknown language falls through to the account's default (undefined). */
export function parseSendPreviewQuery(
  q: { channel?: string | null; lang?: string | null },
): { channel: SendPreviewChannel; lang: SendPreviewLang | undefined } {
  const channel = q.channel === "email" || q.channel === "sms"
    ? q.channel
    : "both";
  const lang = q.lang === "en" || q.lang === "es" ? q.lang : undefined;
  return { channel, lang };
}
