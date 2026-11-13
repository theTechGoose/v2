import { PRICING_PLANS } from "#quote-flow/pricing-plans.ts";
import { isSampleQuote } from "#quote-flow/pipeline-stats.ts";

/** where an account stands against its plan's monthly quote cap */
export interface QuoteQuota {
  limit: number;
  used: number;
  reached: boolean;
}

/** the parts of the account's plan record the cap reads */
export interface QuotaPlan {
  planId: string;
  status?: string;
  /** REQ-129 — a downgrade keeps the paid month: unlimited through this day */
  paidThrough?: string;
}

/**
 * REQ-766 (demo-loop cycle 5v2, issue m17): Monster Free is "Up to five quotes and contracts a
 * month" and the paid plans are "Unlimited" — the plan's `limits.quotesPerMonth` is the cap the
 * app holds. Counted: the quotes created in the current calendar month (UTC), the onboarding sample
 * (REQ-241) aside. null when the plan has no cap: a paid plan, a downgrade still inside its paid
 * month, or no plan on record yet (the wizard's plan step picks it before any quote).
 */
export function quoteQuota(
  plan: QuotaPlan | null | undefined,
  quotes: ReadonlyArray<
    { createdAt?: string; isSample?: boolean; summary?: string | null }
  >,
  now: Date,
): QuoteQuota | null {
  if (!plan) return null;
  const limit = PRICING_PLANS.find((p) => p.id === plan.planId)?.limits
    ?.quotesPerMonth;
  if (limit === undefined) return null;
  const today = now.toISOString().slice(0, 10);
  if (plan.paidThrough && plan.paidThrough.slice(0, 10) >= today) return null;
  const month = today.slice(0, 7);
  const used =
    quotes.filter((q) =>
      !isSampleQuote(q) && q.createdAt?.slice(0, 7) === month
    ).length;
  return { limit, used, reached: used >= limit };
}
