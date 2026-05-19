import { Injectable } from "#danet/core";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";

export interface EnsureSampleQuoteInput {
  userId: string;
}
export interface EnsureSampleQuoteResult {
  quoteId: string;
  created: boolean;
}

const SAMPLE_TAG = "onboarding-sample-v1";

/**
 * EnsureSampleQuote — per-user idempotent "see what your customer sees"
 * quote. Created on first ask during onboarding handoff so the link is
 * branded with the user's own businessName / contact info instead of a
 * stale hardcoded Dev Business quote.
 *
 * The quote is tagged via its `summary` prefix so subsequent calls find
 * the same row and skip creation. Bound to no customer (the public
 * quote page renders without a customer block when omitted).
 */
@Injectable()
export class EnsureSampleQuote {
  constructor(private quotes: QuoteStore) {}

  async run(input: EnsureSampleQuoteInput): Promise<EnsureSampleQuoteResult> {
    const existing = await this.quotes.listByUser(input.userId);
    const found = existing.find((q) => (q.summary ?? "").startsWith(SAMPLE_TAG));
    if (found) return { quoteId: found.id, created: false };

    // Stock paver-patio example — small, concrete, easy to scan in 5s.
    // Cents totals: $2,200 + $1,500 = $3,700.
    const quote = await this.quotes.create(input.userId, {
      summary: `${SAMPLE_TAG} · Paver Patio Installation`,
      jobName: "Paver Patio Installation",
      description:
        "This is a SAMPLE quote so you can see what your customers receive. Real quotes will use the details you give the assistant.",
      lineItems: [
        { description: "Paver patio install (materials)", quantity: 1, unit: "ea", price: 2_200_00 },
        { description: "Paver patio install (labor)",     quantity: 1, unit: "ea", price: 1_500_00 },
      ],
      estimatedTotal: 3_700_00,
      status: "sent",
    });
    return { quoteId: quote.id, created: true };
  }
}
