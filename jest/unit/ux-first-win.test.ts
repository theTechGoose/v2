/**
 * First-win visibility — ux-problems.md:
 *
 *   UX-02 "The user's first accepted quote is invisible everywhere — the aha
 *         moment reads as 'nothing happened'. … Dashboard 'Trabajos activos: 0'
 *         … The $3,700 vanishes from every number: … no 'ganado/por facturar'
 *         bucket exists; the win's value appears nowhere."
 *
 * Phones: none (pure logic — no network).
 *
 * Target module: shared/quote-flow/pipeline-stats.ts
 *
 * Post Quote+Contract merge there is no contract entity: the quote carries
 * its own acceptance (status "accepted" / acceptedAt) and its own customerId
 * (SendQuote backfills it from the conversation BEFORE dispatch), so the
 * classifier, aggregator and job-customer resolver all take ONE argument.
 *
 *   1. `aggregatePipeline(quotes)` exposes the won-value bucket:
 *        wonCents — INTEGER cents won (sum of estimatedTotal over WON,
 *        non-sample quotes) — the "ganado / por facturar" money.
 *      Sample quotes (isSampleQuote) contribute NOTHING to wonCents,
 *      exactly like every other aggregate.
 *
 *   2. `resolveJobCustomerId(quote)` — the customer a job renders under is
 *      the quote's OWN link (there is no agreement to fall back to);
 *      null when the quote has none.
 */
import {
  aggregatePipeline,
  classifyQuoteForPipeline,
  resolveJobCustomerId,
} from "../../shared/quote-flow/pipeline-stats";

// ---------------------------------------------------------------------------
// Fixtures — the audit's exact first-win state, in the merged model: a
// $3,700 quote the customer accepted on /q (status "accepted" + acceptedAt),
// its agreement terms drafted onto the quote itself.
// ---------------------------------------------------------------------------

const ACCEPTED_AT = "2026-08-18T18:00:00.000Z";

const acceptedQuote = {
  id: "q-first-win",
  status: "accepted",
  acceptedAt: ACCEPTED_AT,
  estimatedTotal: 370_000, // the audit's $3,700 (INTEGER CENTS)
  summary: "Instalación de patio de adoquines",
  terms: [
    { stepId: "payment_terms", label: "Payment terms", value: "50 / 50" },
  ],
};

describe("UX-02: an accepted quote is a won/active job", () => {
  it("UX-02: classifyQuoteForPipeline: accepted (terms drafted on the quote) → won", () => {
    expect(classifyQuoteForPipeline(acceptedQuote)).toBe("won");
  });

  it("UX-02: aggregatePipeline: the accepted quote is 1 won / 1 active job, not awaiting", () => {
    const agg = aggregatePipeline([acceptedQuote]);
    expect(agg.wonCount).toBe(1);
    expect(agg.activeJobs).toBe(1);
    expect(agg.awaitingCount).toBe(0);
    expect(agg.awaitingCents).toBe(0);
  });
});

describe("UX-02: the win's $3,700 lands in the won bucket — it must not vanish", () => {
  it("UX-02: aggregatePipeline exposes wonCents = 370000 for the accepted quote", () => {
    const agg = aggregatePipeline([acceptedQuote]);
    expect(agg.wonCents).toBe(370_000);
  });

  it("UX-02: wonCents stays integer cents when several wins sum", () => {
    const second = {
      id: "q-second-win",
      status: "accepted",
      acceptedAt: ACCEPTED_AT,
      estimatedTotal: 85_030,
      summary: "Reparación de cerca",
    };
    const agg = aggregatePipeline([acceptedQuote, second]);
    expect(agg.wonCents).toBe(455_030);
    expect(Number.isInteger(agg.wonCents)).toBe(true);
  });

  it("UX-02: a sample quote contributes NOTHING to wonCents (P-15 discipline)", () => {
    const acceptedSample = {
      id: "q-sample",
      status: "accepted",
      acceptedAt: ACCEPTED_AT,
      summary: "onboarding-sample-v1 · Paver Patio Installation",
      estimatedTotal: 370_000,
    };
    const agg = aggregatePipeline([acceptedSample]);
    expect(agg.wonCents).toBe(0);
  });
});

describe("UX-02: job customer resolution reads the quote's own link", () => {
  it("UX-02: resolveJobCustomerId is exported from pipeline-stats", () => {
    // The seam list-active-jobs wires in so the freshly won job renders.
    expect(typeof resolveJobCustomerId).toBe("function");
  });

  it("UX-02: the quote's own customerId keeps the job visible", () => {
    expect(resolveJobCustomerId({ customerId: "cust-maria" })).toBe(
      "cust-maria",
    );
  });

  it("UX-02: null when the quote carries no customer link", () => {
    expect(resolveJobCustomerId({})).toBe(null);
    expect(resolveJobCustomerId({ customerId: undefined })).toBe(null);
    expect(resolveJobCustomerId({ customerId: null })).toBe(null);
    expect(resolveJobCustomerId({ customerId: "" })).toBe(null);
  });
});
