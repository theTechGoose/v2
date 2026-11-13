import {
  classifyQuoteForPipeline,
  isSampleQuote,
} from "#quote-flow/pipeline-stats.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";
import type { Quote } from "@paperwork/dto/quote.ts";

/**
 * REQ-562 (demo-loop cycle 4, M38 + m21) — the ONE rule for "a signed job and
 * whether it is still in flight". The dashboard's Active jobs (ListActiveJobs)
 * and the Customers page (BuildCustomerCards → hero, chips, card status) both
 * read it, so "ACTIVE JOBS 1" and "0 signed jobs" can no longer disagree.
 *
 * A job is a WON quote (the pipeline's rule: accepted/signed), never the
 * onboarding sample. It is complete once it has invoices and every non-void
 * one is paid — a scheduled installment still to bill keeps it in flight.
 */
export function isSignedJob(
  q: Pick<Quote, "status" | "sentAt" | "acceptedAt" | "lostAt" | "summary"> & {
    isSample?: boolean;
  },
): boolean {
  if (isSampleQuote(q)) return false;
  return classifyQuoteForPipeline({
    status: q.status,
    sentAt: q.sentAt,
    acceptedAt: q.acceptedAt,
    lostAt: q.lostAt,
  }) === "won";
}

/** Every non-void invoice linked to the job is paid (and there is one). */
export function isJobComplete(related: Pick<Invoice, "status">[]): boolean {
  const billable = related.filter((i) => i.status !== "void");
  return billable.length > 0 && billable.every((i) => i.status === "paid");
}

/**
 * Jobs in flight and jobs done, over one customer's (or one user's) quotes
 * and invoices. A paid invoice tied to no signed job (standalone, or its
 * quote isn't won) is a completed job of its own — grouped by its quoteId
 * when it has one.
 */
export function countJobs(
  quotes: Quote[],
  invoices: Pick<Invoice, "id" | "quoteId" | "status">[],
): { active: number; completed: number } {
  const jobIds = new Set(quotes.filter(isSignedJob).map((q) => q.id));
  const byJob = new Map<string, Pick<Invoice, "status">[]>();
  for (const id of jobIds) byJob.set(id, []);
  const standalonePaid = new Set<string>();
  for (const i of invoices) {
    if (i.quoteId && jobIds.has(i.quoteId)) byJob.get(i.quoteId)!.push(i);
    else if (i.status === "paid") standalonePaid.add(i.quoteId || i.id);
  }
  let active = 0;
  let completed = standalonePaid.size;
  for (const related of byJob.values()) {
    if (isJobComplete(related)) completed++;
    else active++;
  }
  return { active, completed };
}

/** Distinct jobs among these paid invoices: one per quote, a standalone
 *  invoice its own — two installments of one job are one paid job. */
export function countPaidJobs(
  invoices: Pick<Invoice, "id" | "quoteId" | "status">[],
): number {
  return new Set(
    invoices.filter((i) => i.status === "paid").map((i) => i.quoteId || i.id),
  ).size;
}

/**
 * REQ-698 (demo-loop cycle 5, m14) — the "Avg. paid job" numbers: the jobs
 * COMPLETED (every non-void invoice paid, `isJobComplete`) whose last payment
 * landed in `year`, and what they were paid in total (cents). A job is its
 * quote's invoices, a standalone invoice its own. A $1,450 job with only its
 * $725 deposit paid is not a paid job yet — it read "AVG. PAID JOB $725".
 */
export function completedJobsInYear(
  invoices: Pick<Invoice, "id" | "quoteId" | "status" | "paidAt" | "amount">[],
  year: number,
): { count: number; cents: number } {
  const byJob = new Map<string, typeof invoices>();
  for (const i of invoices) {
    const key = i.quoteId || i.id;
    const list = byJob.get(key);
    if (list) list.push(i);
    else byJob.set(key, [i]);
  }
  let count = 0;
  let cents = 0;
  for (const related of byJob.values()) {
    if (!isJobComplete(related)) continue;
    const paid = related.filter((i) => i.status === "paid");
    const last = paid.map((i) => i.paidAt ?? "").sort().at(-1);
    if (!last || new Date(last).getUTCFullYear() !== year) continue;
    count++;
    cents += paid.reduce((sum, i) => sum + (i.amount ?? 0), 0);
  }
  return { count, cents };
}
