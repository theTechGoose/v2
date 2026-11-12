/**
 * REQ-587 (demo-loop cycle 4, M27) — the "Which invoice?" option in the
 * /payments "Record a payment" modal, in the app's language.
 *
 * The label leads with the invoice number (INV-001), then the job name in
 * the language the app is showing (jobNameByLang[lang], only while that map
 * is current — invoiceTextByLang — else the stored jobName). With neither,
 * it is the localized word ("Factura"), never a hard-coded English one.
 */
import { invoiceTextByLang } from "../../shared/documents/invoice-lang.ts";
import { fmtMoney } from "./format.ts";
import { type Lang, tFor } from "./i18n.ts";

export interface RecordOptionInvoice {
  number?: string | null;
  amount?: number | null;
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
    amount: fmtMoney(inv.amount ?? 0),
  });
}
