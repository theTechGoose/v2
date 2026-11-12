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

export type Translate = (
  key: string,
  vars?: Record<string, string | number>,
) => string;

export function receivedNoteBody(
  t: Translate,
  lang: "en" | "es",
  { paidAt, who }: { paidAt?: string; who: string },
): string {
  const date = formatLongDate(paidAt, lang);
  const when = date ? t("publicInvoice.received.onDate", { date }) : "";
  return t("publicInvoice.received.body", { who, when });
}
