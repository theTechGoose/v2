/**
 * Invoice card rules shared by islands/InvoicesPage.tsx (REQ-407, demo-loop
 * cycle 2 m30 / p13-f): the card's short date and which secondary actions
 * sit beside the stage CTA.
 */
import { type Lang, tFor } from "./i18n.ts";

export type CardStage =
  | "scheduled"
  | "overdue"
  | "out"
  | "claimed"
  | "drafting"
  | "paid";

const SHORT_MONTH = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function monthLabel(idx: number, lang: Lang): string {
  return tFor(lang, `invoicesPage.month.${SHORT_MONTH[idx].toLowerCase()}`);
}

/** The card's short date: "Nov 19" this year, "Jan 5, 2027" otherwise. */
export function cardDate(
  iso: string | undefined,
  now: Date,
  lang: Lang,
): string {
  if (!iso) return "—";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  if (Number.isNaN(d.getTime())) return iso;
  const sameYear = d.getFullYear() === now.getFullYear();
  return sameYear
    ? `${monthLabel(d.getMonth(), lang)} ${d.getDate()}`
    : `${monthLabel(d.getMonth(), lang)} ${d.getDate()}, ${d.getFullYear()}`;
}

/**
 * REQ-018 lets the contractor say "Payment received" on anything still owed.
 * An out card's stage CTA already IS that (invoicesPage.cta.outReceived), so
 * only an overdue card — whose CTA is "Nudge" — carries the extra button
 * (m30: the out card read "Payment received / Open / Payment received").
 */
export function hasSecondaryPaymentReceived(stage: CardStage): boolean {
  return stage === "overdue";
}

/** "Scheduled to send Nov 26" — the same short date as the due dates (p13-f). */
export function scheduledSubline(
  scheduledFor: string | undefined,
  now: Date,
  lang: Lang,
): string {
  return tFor(lang, "invoicesPage.subline.scheduled", {
    date: cardDate(scheduledFor, now, lang),
  });
}
