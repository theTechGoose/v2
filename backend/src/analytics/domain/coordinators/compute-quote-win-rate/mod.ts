import { Injectable } from "#danet/core";
import { isSampleQuote } from "#quote-flow/pipeline-stats.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import type { WinRateResponse } from "@analytics/dto/quotes-stats.ts";

const MS_PER_DAY = 86_400_000;

/**
 * ComputeQuoteWinRate — pure derivation over the user's quotes.
 *
 * A quote is "decided" when it has acceptedAt or lostAt within `windowDays`
 * — only the customer's acceptance (the one signature ceremony) wins; a
 * merely-sent quote decides nothing (P-14). Otherwise it's still in flight
 * (or older than the window) and not counted. Sample quotes contribute to
 * nothing (P-15).
 */
@Injectable()
export class ComputeQuoteWinRate {
  constructor(private quotes: QuoteStore) {}

  async run(
    userId: string,
    windowDays = 90,
    now: Date = new Date(),
  ): Promise<WinRateResponse> {
    const cutoffMs = now.getTime() - windowDays * MS_PER_DAY;

    const quotes = await this.quotes.listByUser(userId);

    let won = 0, lost = 0;
    for (const q of quotes) {
      if (isSampleQuote(q)) continue; // P-15: samples decide nothing
      const acceptedAt = q.acceptedAt ? new Date(q.acceptedAt).getTime() : null;
      const lostAt = q.lostAt ? new Date(q.lostAt).getTime() : null;
      const wonInWindow = acceptedAt !== null && acceptedAt >= cutoffMs;
      const lostInWindow = lostAt !== null && lostAt >= cutoffMs;

      if (wonInWindow) won++;
      else if (lostInWindow) lost++;
    }

    const decided = won + lost;
    const winRate = decided === 0 ? null : Math.round((won / decided) * 100);

    return { windowDays, decided, won, lost, winRate };
  }
}
