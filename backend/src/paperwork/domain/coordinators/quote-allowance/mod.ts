import { Injectable } from "#danet/core";
import { PlanStore } from "@users/domain/data/plan-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { quoteQuota } from "@paperwork/domain/business/quote-quota/mod.ts";

export type QuoteAllowed =
  | { ok: true }
  | { ok: false; reason: "quote_limit"; limit: number; used: number };

/**
 * REQ-766 (demo-loop cycle 5v2, issue m17): may this account make another quote this month? Every
 * path that makes a quote (POST /quotes, the assistant's create_quote) asks first, so Monster
 * Free's "Up to five quotes and contracts a month" is what the app does.
 */
@Injectable()
export class QuoteAllowance {
  constructor(
    private plans: PlanStore = new PlanStore(),
    private quotes: QuoteStore = new QuoteStore(),
  ) {}

  async check(userId: string, now = new Date()): Promise<QuoteAllowed> {
    const plan = await this.plans.get(userId);
    if (!plan) return { ok: true };
    const quota = quoteQuota(plan, await this.quotes.listByUser(userId), now);
    if (!quota?.reached) return { ok: true };
    return {
      ok: false,
      reason: "quote_limit",
      limit: quota.limit,
      used: quota.used,
    };
  }
}
