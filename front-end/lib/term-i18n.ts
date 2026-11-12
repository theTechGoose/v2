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

export function localizeTermValue(value: string, lang: Lang): string {
  // REQ-495 (m17): a picked start date is stored ISO (older quotes carry
  // MM/DD/YYYY) — read it in the reader's language, in both languages.
  if (termDateIso(value)) return formatTermDate(value, lang);
  if (lang !== "es") return value;
  const trimmed = (value ?? "").trim();
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
    .replace(/\bdays\b/gi, "días").replace(/\bday\b/gi, "día")
    // REQ-665 (m47): the custom picker's worded two-payment split.
    .replace(
      /^(\d+(?:\.\d+)?)% upfront, (\d+(?:\.\d+)?)% on completion$/i,
      "$1% por adelantado, $2% al terminar",
    );
}
