import { Injectable } from "#danet/core";
import { isSampleQuote } from "#quote-flow/pipeline-stats.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { t } from "@core/i18n/mod.ts";

export interface EnsureSampleQuoteInput {
  userId: string;
  /** Recipient/contractor language for the customer-facing sample copy. Defaults to "en". */
  language?: "en" | "es";
}
export interface EnsureSampleQuoteResult {
  quoteId: string;
  created: boolean;
}

/**
 * EnsureSampleQuote — per-user idempotent "see what your customer sees"
 * quote. Created on first ask during onboarding handoff so the link is
 * branded with the user's own businessName / contact info instead of a
 * stale hardcoded Dev Business quote.
 *
 * The quote is stamped `isSample: true` (P-15) so pipeline/money/open
 * aggregates skip it while the card stays visible and badged. Copy is
 * localized to the contractor's language. Subsequent calls find the same
 * row (flag, or the legacy "onboarding-sample-v1" summary prefix) and
 * skip creation. Bound to no customer (the public quote page renders
 * without a customer block when omitted).
 */
@Injectable()
export class EnsureSampleQuote {
  constructor(private quotes: QuoteStore) {}

  async run(input: EnsureSampleQuoteInput): Promise<EnsureSampleQuoteResult> {
    const lang = input.language ?? "en";
    const existing = await this.quotes.listByUser(input.userId);
    const found = existing.find((q) => isSampleQuote(q));
    if (found) return { quoteId: found.id, created: false };

    // Stock paver-patio example — small, concrete, easy to scan in 5s.
    // Cents totals: $2,200 + $1,500 = $3,700.
    const jobName = t(lang, "ensureSampleQuote.jobName");
    const quote = await this.quotes.create(input.userId, {
      // Clean, human summary — the internal sample tag lives in the
      // dedicated isSample flag, never in rendered copy (P-15).
      summary: jobName,
      jobName,
      isSample: true,
      description: t(lang, "ensureSampleQuote.description"),
      lineItems: [
        { description: t(lang, "ensureSampleQuote.lineItem.materials"), quantity: 1, unit: "ea", price: 2_200_00 },
        { description: t(lang, "ensureSampleQuote.lineItem.labor"),     quantity: 1, unit: "ea", price: 1_500_00 },
      ],
      estimatedTotal: 3_700_00,
      status: "sent",
    });
    return { quoteId: quote.id, created: true };
  }
}
