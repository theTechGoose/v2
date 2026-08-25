/**
 * Localize a STORED agreement-term value into `lang` for display.
 *
 * Agreement terms are persisted in English (the neutral base — see the backend
 * `captureTerms`). This maps a stored English value to the reader's language.
 * Shared by the public agreement (`components/quote-doc.tsx`) and the in-app
 * Quote+Agreement preview (`islands/AsstChat.tsx`) so the contractor's preview
 * always matches what the customer actually receives.
 *
 * EN is the identity (returns the value unchanged); ES uses an exact-match map
 * for the preset picks, then a word-level fallback for free-text durations.
 */
import { type Lang, tFor } from "./i18n.ts";

export function localizeTermValue(value: string, lang: Lang): string {
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
    "Due Now": "quoteDoc.termValue.dueNow",
  };
  if (exact[trimmed]) return tFor(lang, exact[trimmed]);
  return trimmed
    .replace(/\bmonths\b/gi, "meses").replace(/\bmonth\b/gi, "mes")
    .replace(/\bweeks\b/gi, "semanas").replace(/\bweek\b/gi, "semana")
    .replace(/\bdays\b/gi, "días").replace(/\bday\b/gi, "día");
}
