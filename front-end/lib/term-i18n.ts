/**
 * Localize a STORED contract-term value into `lang` for display.
 *
 * Contract terms are persisted in English (the neutral base — see the backend
 * `captureTerms`). This maps a stored English value to the reader's language.
 * Shared by the public agreement (`components/contract-doc.tsx`) and the in-app
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
    "Payment upon completion": "contractDoc.termValue.paymentUponCompletion",
    "Deposit + balance": "contractDoc.termValue.depositBalance",
    "No warranty": "contractDoc.termValue.noWarranty",
    "Right away": "contractDoc.termValue.rightAway",
    "Next week": "contractDoc.termValue.nextWeek",
    "Next Month": "contractDoc.termValue.nextMonth",
    "Next month": "contractDoc.termValue.nextMonth",
    "Job Completed": "contractDoc.termValue.jobCompleted",
    "Due Now": "contractDoc.termValue.dueNow",
  };
  if (exact[trimmed]) return tFor(lang, exact[trimmed]);
  return trimmed
    .replace(/\bmonths\b/gi, "meses").replace(/\bmonth\b/gi, "mes")
    .replace(/\bweeks\b/gi, "semanas").replace(/\bweek\b/gi, "semana")
    .replace(/\bdays\b/gi, "días").replace(/\bday\b/gi, "día");
}
