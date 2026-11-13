/**
 * REQ-461 (demo-loop cycle 3, m8) — the send dialog's "What they'll get":
 * GET /quotes/:id/send-preview renders the quote's email (subject + body)
 * and text in the picked send language without sending. Shared by the
 * backend route (query parsing) and the front-end client (path + sections).
 *
 * Pure logic, no side effects.
 */
import { formatPhoneDisplay } from "./format-helpers.ts";

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

/** REQ-593 (cycle 4, m12): the number the text preview names, formatted
 *  ("+1 (512) 867-5309") — "" when the preview has no text recipient. */
export function sendPreviewSmsTo(preview: QuoteSendPreview): string {
  const to = preview.sms?.to?.trim();
  return to ? formatPhoneDisplay(to) : "";
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

/** REQ-727 (demo-loop cycle 5, c4-M16): the dates a send will stamp on an
 *  unissued invoice ("Finish + send" / "Send now"), so its preview reads as
 *  the client will get it. yyyy-mm-dd. */
export interface SendPreviewDates {
  issuedDate?: string;
  dueDate?: string;
}

/** A calendar date as yyyy-mm-dd, or nothing. */
function isoDate(v: string | null | undefined): string | undefined {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
    ? v
    : undefined;
}

/**
 * REQ-727: GET /invoices/:id/send-preview — the invoice's email and text as
 * the client gets them if it is sent now. No `lang`: the server answers in
 * the invoice's own language (its `lang`, else its quote's send language,
 * else the Settings default) and says which in `lang`.
 */
export function invoiceSendPreviewPath(
  invoiceId: string,
  channel: SendPreviewChannel,
  lang?: SendPreviewLang,
  dates: SendPreviewDates = {},
): string {
  const q = [`channel=${channel}`];
  if (lang) q.push(`lang=${lang}`);
  const issued = isoDate(dates.issuedDate);
  const due = isoDate(dates.dueDate);
  if (issued) q.push(`issuedDate=${issued}`);
  if (due) q.push(`dueDate=${due}`);
  return `/invoices/${encodeURIComponent(invoiceId)}/send-preview?${
    q.join("&")
  }`;
}

/** REQ-727: the invoice preview route's query, read safely — the quote
 *  route's channel / language rule, plus a date only when it is one. */
export function parseInvoiceSendPreviewQuery(
  q: {
    channel?: string | null;
    lang?: string | null;
    issuedDate?: string | null;
    dueDate?: string | null;
  },
): {
  channel: SendPreviewChannel;
  lang: SendPreviewLang | undefined;
  issuedDate?: string;
  dueDate?: string;
} {
  const issuedDate = isoDate(q.issuedDate);
  const dueDate = isoDate(q.dueDate);
  return {
    ...parseSendPreviewQuery(q),
    ...(issuedDate ? { issuedDate } : {}),
    ...(dueDate ? { dueDate } : {}),
  };
}
