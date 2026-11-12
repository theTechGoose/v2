/**
 * Invoice card rules shared by islands/InvoicesPage.tsx (REQ-407, demo-loop
 * cycle 2 m30 / p13-f): the card's short date and which secondary actions
 * sit beside the stage CTA.
 */
import { type Lang, tFor } from "./i18n.ts";
import { cardFieldPatch } from "./customer-card-edit.ts";

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

/** yyyy-mm-dd + n days (UTC calendar arithmetic) */
function addDaysIso(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** whole days from `a` to `b` (yyyy-mm-dd), or null when either is no date */
function daysBetween(a?: string, b?: string): number | null {
  if (!a || !b) return null;
  const from = Date.parse(a.slice(0, 10) + "T00:00:00Z");
  const to = Date.parse(b.slice(0, 10) + "T00:00:00Z");
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.round((to - from) / 86_400_000);
}

/**
 * REQ-554 (demo-loop cycle 4, m52): "Send now" issues a scheduled invoice
 * TODAY, so its dates follow — issued today, due today + its days to pay.
 * Those are its `netDays` when on file, else the span its schedule had
 * (scheduledFor → dueDate: a milestone placeholder is due 7 days after its
 * slot). Never due before it is issued. With neither, only the issue date.
 */
export function sendNowDates(
  inv: { netDays?: number; scheduledFor?: string; dueDate?: string },
  todayIso: string,
): { issuedDate: string; dueDate?: string } {
  const span = typeof inv.netDays === "number"
    ? inv.netDays
    : daysBetween(inv.scheduledFor, inv.dueDate);
  if (span === null) return { issuedDate: todayIso };
  return {
    issuedDate: todayIso,
    dueDate: addDaysIso(todayIso, Math.max(0, span)),
  };
}

/**
 * REQ-554 (m52): a half-delivered send is two facts — the channel that went
 * (good news, shown green) and the one that failed (shown red) — not one
 * sentence in the failure red.
 */
export function partialSendParts(
  lang: Lang,
  failedChannel: "email" | "text",
  reason: string,
): { went: string; failed: string } {
  return failedChannel === "text"
    ? {
      went: tFor(lang, "invoicesPage.send.wentEmail"),
      failed: tFor(lang, "invoicesPage.send.failedText", { reason }),
    }
    : {
      went: tFor(lang, "invoicesPage.send.wentText"),
      failed: tFor(lang, "invoicesPage.send.failedEmail", { reason }),
    };
}

/**
 * REQ-552 (demo-loop cycle 4, m25): bring the "Payment received" form on
 * screen after a card opens the detail in pay mode. The window is not the
 * scroller on desktop (`.app` is fixed-height overflow:hidden, `.content`
 * scrolls), so `window.scrollTo` is a no-op there — scrollIntoView walks up
 * to whichever ancestor scrolls (the QuotesPage panel pattern). The first
 * method button gets focus so the form reads as opened (and keyboard users
 * land in it). Returns false when the form is not mounted.
 */
export function revealPayForm(root: ParentNode): boolean {
  const form = root.querySelector<HTMLElement>("[data-cy=pay-received-form]");
  if (!form) return false;
  form.scrollIntoView({ block: "start", behavior: "auto" });
  form.querySelector<HTMLElement>("button[data-cy^=pay-method-]")?.focus({
    preventScroll: true,
  });
  return true;
}

/**
 * REQ-695 (demo-loop cycle 5, m55): the card's inline "Add email or phone"
 * after a send found no contact on file. One field: an "@" makes it an
 * email, anything else a phone — checked with the customer card's own rule
 * (`cardFieldPatch`, REQ-600). It is saved where the send endpoints read
 * it: the linked customer (PUT /api/customers/:id), else the invoice's own
 * bill-to (PUT /api/invoices/:id, keeping the rest of the bill-to).
 * `channel` is the one the saved contact can be sent on.
 */
export function contactFixRequest(
  raw: string,
  target: {
    invoiceId: string;
    customerId?: string | null;
    billTo?: Record<string, unknown> | null;
  },
):
  | { url: string; body: Record<string, unknown>; channel: "email" | "text" }
  | { error: string } {
  const value = (raw ?? "").trim();
  if (!value) return { error: "invoicesPage.send.addContactInvalid" };
  const channel = value.includes("@") ? "email" : "text";
  const checked = cardFieldPatch(
    channel === "email" ? "email" : "phone",
    value,
  );
  if ("error" in checked) return { error: checked.error };
  if (target.customerId) {
    return {
      url: `/api/customers/${encodeURIComponent(target.customerId)}`,
      body: checked.patch,
      channel,
    };
  }
  return {
    url: `/api/invoices/${encodeURIComponent(target.invoiceId)}`,
    body: { billTo: { ...(target.billTo ?? {}), ...checked.patch } },
    channel,
  };
}
