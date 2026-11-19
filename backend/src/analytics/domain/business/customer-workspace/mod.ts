/**
 * REQ-924 — the customer workspace's pure rules. One customer's money summary (the same open-receivable
 * rule as the customer card, REQ-397), the monthly estimate of a repeat visit, its next visits by the
 * schedule (REQ-139/157/787 `isDue`, so the page needs no generated tasks), and which done visits are
 * not billed yet. No I/O.
 */
import type { FieldTask, Subscription } from "@field/dto/field.ts";
import { intervalOf, daysOf, isDue, monthDaysOf, shiftDate } from "@field/domain/business/schedule/mod.ts";
import { isOpenReceivable, receivableBalanceCents } from "@paperwork/domain/business/open-receivable/mod.ts";
import { quoteState } from "#documents/versions.ts";

const WEEKS_PER_MONTH = 52 / 12;
/** invoices that count as billed: out with the customer, or paid */
const BILLED = new Set(["sent", "viewed", "claimed", "pending", "paid"]);
/** quotes waiting on the customer */
const OPEN_QUOTE = new Set(["sent", "revised"]);

/** the price of one visit: its services' prices summed */
export const perVisitCents = (s: Pick<Subscription, "items">): number =>
  s.items.reduce((sum, i) => sum + (i.priceCents ?? 0), 0);

/** visits in an average month: weekly × weeks-per-month ÷ interval, monthly × days, annual ÷ 12 */
export function monthlyVisits(s: Subscription): number {
  if (s.cadence === "annual") return monthDaysOf(s).length / 12;
  if (s.cadence === "monthly") return monthDaysOf(s).length;
  return (daysOf(s).length * WEEKS_PER_MONTH) / intervalOf(s);
}

/** REQ-1063 — its end date is past: it runs no more visits, though nobody paused it (still active) */
export const hasEnded = (s: { endDate?: string }, today: string): boolean => !!s.endDate && s.endDate < today;

/** REQ-1063 — still running: active and not past its end date */
export const isRunning = (s: { active: boolean; endDate?: string }, today: string): boolean =>
  s.active && !hasEnded(s, today);

/** REQ-1063 — every visit left from `today` up to the end date (counted as `nextVisits` counts them,
 *  without its cap); undefined when the service has no end date — it runs on, nothing is "left" */
export function remainingVisits(s: Subscription, today: string, taken: ReadonlySet<string> = new Set()): number | undefined {
  if (!s.endDate) return undefined;
  if (!isRunning(s, today)) return 0;
  return nextVisits(s, today, Number.MAX_SAFE_INTEGER, taken).length;
}

/** the next `count` visit dates on or after `today` — none for a paused service; `taken`: days whose
 *  visit is already done or skipped (not "next"); looks ahead at most two years */
export function nextVisits(s: Subscription, today: string, count: number, taken: ReadonlySet<string> = new Set()): string[] {
  if (!s.active || count <= 0) return [];
  const out: string[] = [];
  for (let i = 0, d = today; i < 731 && out.length < count; i++, d = shiftDate(today, i)) {
    if (s.endDate && d > s.endDate) break;
    if (isDue(s, d) && !taken.has(d)) out.push(d);
  }
  return out;
}

/** a done visit that is not on a live invoice yet */
export function isUnbilled(
  t: Pick<FieldTask, "status" | "invoiceId"> & { deleted?: boolean },
  liveInvoiceIds: ReadonlySet<string>,
): boolean {
  if (t.status !== "complete" || t.deleted) return false;
  return !(t.invoiceId && liveInvoiceIds.has(t.invoiceId));
}

export interface SummaryInvoice {
  id?: string;
  status?: string;
  amount?: number;
  paidCents?: number | null;
  paidAt?: string;
  dueDate: string;
}
export interface SummaryPayment {
  amount: number;
  method: string;
  receivedAt: string;
}
export interface SummaryQuote {
  status?: string;
  acceptedAt?: string;
  version?: number;
  estimatedTotal?: number;
}
export interface SummaryService {
  active: boolean;
  perVisitCents: number;
  monthlyVisits: number;
  /** REQ-1063 — past it the service is ended: neither active nor recurring */
  endDate?: string;
  nextVisit?: string;
}

export interface WorkspaceSummary {
  /** what is owed now — open receivables at their balance, less credits and deposits (the card's balance) */
  owedCents: number;
  /** the part of it past due */
  overdueCents: number;
  /** lifetime: every invoice sent or paid, at its amount */
  billedCents: number;
  /** what was paid on those invoices */
  paidCents: number;
  lastPayment?: { amountCents: number; method: string; receivedAt: string };
  openQuotes: number;
  openQuotesCents: number;
  activeServices: number;
  /** ≈ per month, active services only (an ended one — past its end date — is not active, REQ-1063) */
  recurringMonthlyCents: number;
  /** REQ-1063 — the earliest end date among the running services; absent when none has one */
  recurringEndsOn?: string;
  nextVisit?: string;
  unbilledVisits: number;
  unbilledCents: number;
}

export function workspaceSummary(input: {
  today: string;
  invoices: SummaryInvoice[];
  payments: SummaryPayment[];
  quotes: SummaryQuote[];
  services: SummaryService[];
  /** the price of each done-not-billed visit */
  unbilledVisitCents: number[];
}): WorkspaceSummary {
  let owedCents = 0, overdueCents = 0, billedCents = 0, paidCents = 0;
  for (const i of input.invoices) {
    if (isOpenReceivable(i)) {
      const bal = receivableBalanceCents(i);
      owedCents += bal;
      if (i.dueDate < input.today) overdueCents += bal;
    } else if (i.status === "credit" || i.status === "deposit") {
      owedCents -= i.amount ?? 0;
    }
    if (BILLED.has(i.status ?? "")) {
      billedCents += i.amount ?? 0;
      paidCents += i.status === "paid" ? i.amount ?? 0 : Math.max(0, i.paidCents ?? 0);
    }
  }
  const last = [...input.payments].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0];
  const open = input.quotes.filter((q) => OPEN_QUOTE.has(quoteState(q)));
  const active = input.services.filter((s) => isRunning(s, input.today));
  const next = active.map((s) => s.nextVisit).filter((d): d is string => !!d).sort()[0];
  const endsOn = active.map((s) => s.endDate).filter((d): d is string => !!d).sort()[0];
  return {
    owedCents,
    overdueCents,
    billedCents,
    paidCents,
    ...(last ? { lastPayment: { amountCents: last.amount, method: last.method, receivedAt: last.receivedAt } } : {}),
    openQuotes: open.length,
    openQuotesCents: open.reduce((sum, q) => sum + (q.estimatedTotal ?? 0), 0),
    activeServices: active.length,
    recurringMonthlyCents: Math.round(active.reduce((sum, s) => sum + s.perVisitCents * s.monthlyVisits, 0)),
    ...(endsOn ? { recurringEndsOn: endsOn } : {}),
    ...(next ? { nextVisit: next } : {}),
    unbilledVisits: input.unbilledVisitCents.length,
    unbilledCents: input.unbilledVisitCents.reduce((a, b) => a + b, 0),
  };
}
