import { Injectable } from "#danet/core";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { ViewStore } from "@paperwork/domain/data/view-store/mod.ts";
import type { InsightResponse } from "@analytics/dto/quotes-stats.ts";

const STATIC_FALLBACK =
  "Most quotes are accepted within the first 48 hours after the customer first opens them.";

/**
 * ComputeQuoteInsight — single-line statistical observation for the
 * `<QSideTip>` panel. Returns a static fallback until the user has at
 * least 10 decided quotes worth of signal; afterward returns a real
 * observation derived from views per accepted quote.
 *
 * Pure read coordinator. No persistence.
 */
@Injectable()
export class ComputeQuoteInsight {
  constructor(
    private quotes: QuoteStore,
    private views:  ViewStore,
  ) {}

  async run(userId: string): Promise<InsightResponse> {
    const quotes = await this.quotes.listByUser(userId);
    const decided = quotes.filter((q) => q.acceptedAt || q.lostAt);
    if (decided.length < 10) {
      return { text: STATIC_FALLBACK, kind: "static_fallback" };
    }

    // Real observation: average open count before acceptance.
    const allViews = await this.views.listByType("quote");
    const accepted = quotes.filter((q) => q.acceptedAt);
    if (accepted.length === 0) {
      return { text: STATIC_FALLBACK, kind: "static_fallback" };
    }

    let totalOpens = 0;
    for (const q of accepted) {
      const before = allViews.filter((v) =>
        v.paperworkId === q.id &&
        new Date(v.viewedAt).getTime() <= new Date(q.acceptedAt!).getTime()
      );
      totalOpens += before.length;
    }
    const avg = totalOpens / accepted.length;
    const text = `Your average quote is opened ${avg.toFixed(1)}× before acceptance.`;
    return { text, kind: "open_count" };
  }
}
