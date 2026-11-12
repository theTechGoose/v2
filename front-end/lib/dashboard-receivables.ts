/**
 * REQ-473 (demo-loop cycle 3, issue M8) — what the dashboard says about money
 * that is owed or coming. The demo read "Money owed to you $-0 — No invoices
 * yet" and "Deposit · No due date" on a job signed on "Payment upon
 * completion" terms whose one bill was a SCHEDULED installment.
 *
 * Pure helpers, rendered by islands/DashboardPage.tsx + components/DashSections.tsx.
 */
import { computePaymentSplit } from "./payment-split.ts";

export interface PaidLabel {
  key: string;
  params?: Record<string, string | number>;
}

/** Terms that bill AFTER the job (mirrors send-signed-confirmation's
 *  `completionTerms`: "Payment upon completion", "Net N"). */
const COMPLETION_TERMS =
  /\b(?:upon|on|at) completion\b|\bnet\s*-?\s*\d{1,3}\b/i;

/** The job row's paid label: "$N paid" once anything is paid; otherwise what
 *  the agreed terms say is due first — "Deposit" only when the first
 *  milestone IS a deposit, "Due on completion" for pay-after-the-job terms,
 *  else "Not paid yet". */
export function jobPaidLabel(
  paidCents: number,
  paymentTerms: string | null | undefined,
): PaidLabel {
  if (paidCents > 0) {
    return {
      key: "dashboardPage.job.amountPaid",
      params: { amount: `$${Math.round(paidCents / 100).toLocaleString()}` },
    };
  }
  const terms = (paymentTerms ?? "").trim();
  if (terms && computePaymentSplit(terms, 100)[0]?.role === "deposit") {
    return { key: "dashboardPage.job.deposit" };
  }
  if (COMPLETION_TERMS.test(terms)) {
    return { key: "dashboardPage.job.dueOnCompletion" };
  }
  return { key: "dashboardPage.job.unpaid" };
}

export interface UpcomingBill {
  /** What is left on the installment, INTEGER CENTS. */
  amountCents: number;
  /** The day it bills (scheduledFor, else its due date), ISO yyyy-mm-dd. */
  date: string;
}

interface UpcomingFields {
  status?: string;
  amount?: number;
  paidCents?: number;
  paidAt?: string;
  dueDate: string;
  scheduledFor?: string;
}

/** The earliest unpaid scheduled installment (the backend's
 *  `isUpcomingReceivable` rule) — the "Upcoming: $925 bills Nov 26" line. */
export function nextUpcomingBill(
  invoices: UpcomingFields[],
): UpcomingBill | null {
  let best: UpcomingBill | null = null;
  for (const inv of invoices) {
    if (inv.status !== "scheduled" || inv.paidAt) continue;
    const amountCents = Math.max(0, (inv.amount ?? 0) - (inv.paidCents ?? 0));
    if (amountCents <= 0) continue;
    const date = inv.scheduledFor || inv.dueDate;
    if (!date) continue;
    if (!best || date < best.date) best = { amountCents, date };
  }
  return best;
}

/** The empty text under a $0 "Money owed to you": none when an installment
 *  is upcoming (that line shows instead); "No invoices yet" only when the
 *  account has ZERO invoices; otherwise "All paid up". */
export function outstandingEmptyKey(
  totalInvoices: number,
  upcoming: UpcomingBill | null,
): string | null {
  if (upcoming) return null;
  return totalInvoices > 0
    ? "outstanding.empty.allPaid"
    : "outstanding.empty.noInvoices";
}
