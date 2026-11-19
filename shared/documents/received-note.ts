/**
 * REQ-268 (demo issue M35) — the sentence a paid public invoice (/i/:id)
 * thanks the customer with: "Thanks! Rosa confirmed your payment on
 * November 11, 2026."
 *
 * `paidAt` is the invoice's paidAt — the settling Payment's receivedAt, an
 * ISO timestamp (compute-invoice-balance). It used to go into
 * "publicInvoice.received.onDate" raw, so the customer read
 * "… el 2026-11-11T20:57:57.358Z". It is written out here in the page's
 * language with the one long-date formatter the rest of the documents use.
 *
 * Pure: the caller passes its dictionary lookup (`tFor` bound to the page
 * language on /i; the raw lang/*.json in the unit test).
 */
import { formatLongDate } from "../quote-flow/format-helpers.ts";
import type { ReceiptChannel } from "./receipt-note.ts";

export type Translate = (
  key: string,
  vars?: Record<string, string | number>,
) => string;

/**
 * REQ-556 (demo-loop cycle 4, M7): the last sentence follows where the
 * receipt actually went (`channel`, the invoice's recorded receiptSentVia) —
 * "A PDF receipt is in your inbox" only when it was emailed. No channel keeps
 * the emailed sentence (the caller falls back to REQ-523's receiptChannel).
 */
export function receivedNoteBody(
  t: Translate,
  lang: "en" | "es",
  { paidAt, who, channel, tz }: {
    paidAt?: string;
    who: string;
    channel?: ReceiptChannel;
    /** REQ-944: the business's zone — the paid instant prints as its day there */
    tz?: string;
  },
): string {
  const date = formatLongDate(paidAt, lang, tz);
  const when = date ? t("publicInvoice.received.onDate", { date }) : "";
  const key = channel === "none"
    ? "publicInvoice.received.bodyNone"
    : channel === "text"
    ? "publicInvoice.received.bodyText"
    : "publicInvoice.received.body";
  return t(key, { who, when });
}
