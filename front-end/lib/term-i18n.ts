/**
 * Localize a STORED agreement-term value into `lang` for display.
 *
 * Agreement terms are persisted in English (the neutral base — see the backend
 * `captureTerms`). This maps a stored English value to the reader's language.
 * Shared by the public agreement (`components/quote-doc.tsx`) and the in-app
 * Quote+Agreement preview (`islands/AsstChat.tsx`) so the contractor's preview
 * always matches what the customer actually receives.
 *
 * A date term (REQ-495) is formatted per language; otherwise
 * EN is the identity (returns the value unchanged); ES uses an exact-match map
 * for the preset picks, then a word-level fallback for free-text durations.
 */
import { type Lang, tFor } from "./i18n.ts";
import {
  formatTermDate,
  termDateIso,
} from "../../shared/quote-flow/format-helpers.ts";
import { isUponCompletionTerm } from "../../shared/quote-flow/completion-schedule.ts";
import { localizeDepositTerm } from "../../shared/quote-flow/deposit-term.ts"; // REQ-678

/** REQ-697 (demo-loop cycle 5, m22): the agreement's payment term in the
 *  reader's language, with the days the customer has to pay when it bills
 *  after the job — "Payment upon completion — due within 30 days of the
 *  invoice". Signing schedules that bill due the account's days to pay after
 *  it goes out (REQ-411), so the signed agreement says so. Without a known
 *  window (or for any other term) it is `localizeTermValue`. */
export function paymentTermValue(
  value: string,
  lang: Lang,
  netDays: number | undefined,
): string {
  if (
    typeof netDays === "number" && Number.isInteger(netDays) &&
    netDays >= 0 && isUponCompletionTerm(value)
  ) {
    return netDays === 0
      ? tFor(lang, "quoteDoc.termValue.paymentUponCompletionOnReceipt")
      : tFor(lang, "quoteDoc.termValue.paymentUponCompletionWithin", {
        n: netDays,
      });
  }
  return localizeTermValue(value, lang);
}

export function localizeTermValue(value: string, lang: Lang): string {
  // REQ-495 (m17): a picked start date is stored ISO (older quotes carry
  // MM/DD/YYYY) — read it in the reader's language, in both languages.
  if (termDateIso(value)) return formatTermDate(value, lang);
  if (lang !== "es") return value;
  const trimmed = (value ?? "").trim();
  // REQ-678 (c3-m60): the picked deposit — "Depósito 30% + saldo".
  const deposit = localizeDepositTerm(trimmed, lang, tFor);
  if (deposit) return deposit;
  const exact: Record<string, string> = {
    "Payment upon completion": "quoteDoc.termValue.paymentUponCompletion",
    "Deposit + balance": "quoteDoc.termValue.depositBalance",
    "No warranty": "quoteDoc.termValue.noWarranty",
    "Right away": "quoteDoc.termValue.rightAway",
    "Next week": "quoteDoc.termValue.nextWeek",
    "Next Month": "quoteDoc.termValue.nextMonth",
    "Next month": "quoteDoc.termValue.nextMonth",
    "Job Completed": "quoteDoc.termValue.jobCompleted",
    // NW-24 (REQ-009): new quotes persist the sentence-case value; the
    // line above keeps quotes saved before the casing change localizing.
    "Job completed": "quoteDoc.termValue.jobCompleted",
    "Due Now": "quoteDoc.termValue.dueNow",
    // REQ-046/047: the wizard's TBD pick on start date / duration.
    "TBD": "quoteDoc.termValue.tbd",
    // REQ-343: the service-trade wizard's "Half a day" duration.
    "Half a day": "quoteDoc.termValue.halfDay",
  };
  if (exact[trimmed]) return tFor(lang, exact[trimmed]);
  return trimmed
    // REQ-015: warranty presets persist "1 year" / "2 years".
    .replace(/\byears\b/gi, "años").replace(/\byear\b/gi, "año")
    .replace(/\bmonths\b/gi, "meses").replace(/\bmonth\b/gi, "mes")
    .replace(/\bweeks\b/gi, "semanas").replace(/\bweek\b/gi, "semana")
    // REQ-343: service-trade durations ("2 hours", "4 hours").
    .replace(/\bhours\b/gi, "horas").replace(/\bhour\b/gi, "hora")
    .replace(/\bdays\b/gi, "días").replace(/\bday\b/gi, "día");
}
