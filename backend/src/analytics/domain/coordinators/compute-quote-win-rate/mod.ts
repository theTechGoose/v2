import { Injectable } from "#danet/core";
import { isSampleQuote } from "#quote-flow/pipeline-stats.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { ContractStore } from "@paperwork/domain/data/contract-store/mod.ts";
import type { WinRateResponse } from "@analytics/dto/quotes-stats.ts";

const MS_PER_DAY = 86_400_000;

/**
 * ComputeQuoteWinRate — pure derivation over the user's quotes.
 *
 * A quote is "decided" when it has acceptedAt or lostAt within `windowDays`,
 * OR (won) when a SIGNED contract references its id within the window — an
 * unsigned draft/sent agreement decides nothing (P-14). Otherwise it's still
 * in flight (or older than the window) and not counted. Sample quotes
 * contribute to nothing (P-15).
 */
@Injectable()
export class ComputeQuoteWinRate {
  constructor(
    private quotes:    QuoteStore,
    private contracts: ContractStore,
  ) {}

  async run(userId: string, windowDays = 90, now: Date = new Date()): Promise<WinRateResponse> {
    const cutoffMs = now.getTime() - windowDays * MS_PER_DAY;

    const [quotes, contracts] = await Promise.all([
      this.quotes.listByUser(userId),
      this.contracts.listByUser(userId),
    ]);
    // P-14: only a SIGNED agreement wins a quote. A draft/sent contract row
    // referencing the quote is not a decision.
    const wonViaContract = new Set(
      contracts
        .filter((c) =>
          c.quoteId &&
          (c.status === "signed" || Boolean(c.signedAt)) &&
          new Date(c.signedAt ?? c.createdAt).getTime() >= cutoffMs
        )
        .map((c) => c.quoteId!),
    );

    let won = 0, lost = 0;
    for (const q of quotes) {
      if (isSampleQuote(q)) continue; // P-15: samples decide nothing
      const acceptedAt = q.acceptedAt ? new Date(q.acceptedAt).getTime() : null;
      const lostAt     = q.lostAt     ? new Date(q.lostAt).getTime()     : null;
      const wonInWindow  = acceptedAt !== null && acceptedAt >= cutoffMs;
      const lostInWindow = lostAt     !== null && lostAt     >= cutoffMs;
      const wonByContract = wonViaContract.has(q.id);

      if (wonInWindow || wonByContract) won++;
      else if (lostInWindow) lost++;
    }

    const decided = won + lost;
    const winRate = decided === 0 ? null : Math.round((won / decided) * 100);

    return { windowDays, decided, won, lost, winRate };
  }
}
