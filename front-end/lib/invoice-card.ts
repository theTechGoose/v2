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

/** The card's short date: en "Nov 19" this year, "Jan 5, 2027" otherwise;
 *  es day-first "19 nov" / "5 ene 2027" (REQ-495, demo cycle 3 m17 — the
 *  same order as the receivables header's formatShortDate). */
export function cardDate(
  iso: string | undefined,
  now: Date,
  lang: Lang,
): string {
  if (!iso) return "—";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  if (Number.isNaN(d.getTime())) return iso;
  const sameYear = d.getFullYear() === now.getFullYear();
  const month = monthLabel(d.getMonth(), lang);
  if (lang === "es") {
    return sameYear
      ? `${d.getDate()} ${month}`
      : `${d.getDate()} ${month} ${d.getFullYear()}`;
  }
  return sameYear
    ? `${month} ${d.getDate()}`
    : `${month} ${d.getDate()}, ${d.getFullYear()}`;
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

/**
 * REQ-489 (demo-loop cycle 3, p8-pair1-d): where "Payment received" takes the
 * contractor. Already on /invoices → open the detail IN PLACE (the island
 * sets its openId and replaces the URL with this one, keeping the other
 * params); from any other page → navigate to the /invoices deep link
 * REQ-018 honours.
 */
export function paymentReceivedTarget(
  currentHref: string,
  invoiceId: string,
): { inPlace: boolean; url: string } {
  const here = new URL(currentHref);
  const onInvoices = here.pathname.replace(/\/+$/, "") === "/invoices";
  if (!onInvoices) {
    const q = new URLSearchParams({ open: invoiceId, pay: "1" });
    return { inPlace: false, url: `/invoices?${q}` };
  }
  here.searchParams.set("open", invoiceId);
  here.searchParams.set("pay", "1");
  here.hash = "";
  return { inPlace: true, url: here.pathname + here.search };
}

/**
 * REQ-477 (demo-loop cycle 3, M31): which cards carry the outlined
 * "Send a nudge" beside the stage CTA. A claimed card asks first (REQ-250);
 * an out card — sent, not yet overdue — sends straight away, so a contractor
 * can remind a client before the cadence's first rung. An overdue card's
 * stage CTA already IS the nudge, so it gets no second one.
 */
export function hasNudgeButton(stage: CardStage): boolean {
  return stage === "claimed" || stage === "out";
}
