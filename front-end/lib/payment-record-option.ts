/**
 * REQ-587 (demo-loop cycle 4, M27) — the "Which invoice?" option in the
 * /payments "Record a payment" modal, in the app's language.
 *
 * The label leads with the invoice number (INV-001), then the job name in
 * the language the app is showing (jobNameByLang[lang], only while that map
 * is current — invoiceTextByLang — else the stored jobName). With neither,
 * it is the localized word ("Factura"), never a hard-coded English one.
 *
 * REQ-1081 (q3-16, cites REQ-961): the amount is the balance still owed
 * (amount − paidCents; the full amount when nothing is left, as the form's
 * pre-fill does), to the cent — "$1,000.50", never the rollup "$1,001".
 */
import { invoiceTextByLang } from "../../shared/documents/invoice-lang.ts";
import { fmtMoneyExact } from "./format.ts";
import { type Lang, tFor } from "./i18n.ts";

export interface RecordOptionInvoice {
  number?: string | null;
  amount?: number | null;
  /** REQ-1081: cents already paid; the label shows what is still owed. */
  paidCents?: number | null;
  lang?: string | null;
  jobName?: string | null;
  jobNameByLang?: Record<string, string> | null;
}

export function recordOptionLabel(
  lang: Lang,
  inv: RecordOptionInvoice,
  customer: string | undefined,
): string {
  const number = inv.number?.trim() || "";
  const job = invoiceTextByLang(inv).jobNameByLang?.[lang]?.trim() ||
    inv.jobName?.trim() || "";
  const doc = number && job
    ? tFor(lang, "paymentsPage.record.optionDoc", { number, job })
    : number || job || tFor(lang, "paymentsPage.record.invoiceWord");
  return tFor(lang, "paymentsPage.record.optionLabel", {
    doc,
    customer: customer || "—",
    amount: fmtMoneyExact(recordBalanceCents(inv)),
  });
}

/**
 * REQ-1081: the cents the Record-a-payment option offers — the balance still
 * owed, or the full amount when nothing (or less than nothing) is left. The
 * same rule PaymentReceivedForm uses to pre-fill its Amount field.
 */
export function recordBalanceCents(
  inv: Pick<RecordOptionInvoice, "amount" | "paidCents">,
): number {
  const amount = inv.amount ?? 0;
  const balance = Math.max(0, amount - (inv.paidCents ?? 0));
  return balance > 0 ? balance : amount;
}

/**
 * REQ-909: `/payments?record=<invoiceId>` opens Record a payment on that
 * invoice. The id, trimmed; "" when the query carries none.
 */
export function recordIdFromSearch(search: string): string {
  try {
    const q = search.startsWith("?") ? search.slice(1) : search;
    return new URLSearchParams(q).get("record")?.trim() ?? "";
  } catch {
    return "";
  }
}
