/**
 * First-win visibility — RED (TDD) tests for ux-problems.md:
 *
 *   UX-02 "The user's first accepted quote is invisible everywhere — the aha
 *         moment reads as 'nothing happened'. … Dashboard 'Trabajos activos: 0'
 *         … /api/jobs returns [] for an approved quote that has an auto-created
 *         draft contract … The $3,700 vanishes from every number: … no
 *         'ganado/por facturar' bucket exists; the win's value appears nowhere."
 *
 * Phones: none (pure logic — no network).
 *
 * Target module (EXISTS): shared/quote-flow/pipeline-stats.ts. The green agent
 * must EXTEND it — the existing surface cannot express UX-02's two gaps:
 *
 *   1. `aggregatePipeline(...)` gains a won-value bucket:
 *
 *        export interface PipelineAggregate {
 *          …existing fields…
 *          /** INTEGER cents won (sum of estimatedTotal over WON, non-sample
 *           *  quotes) — the "ganado / por facturar" money that today lands in
 *           *  NO bucket once a quote leaves "sent". *\/
 *          wonCents: number;
 *        }
 *
 *      Sample quotes (isSampleQuote) contribute NOTHING to wonCents, exactly
 *      like every other aggregate.
 *
 *   2. A pure customer-resolution helper for the jobs view:
 *
 *        export function resolveJobCustomerId(
 *          quote: { customerId?: string | null },
 *          contract?: { customerId?: string | null } | null,
 *        ): string | null;
 *          // quote.customerId when present; otherwise the linked agreement's
 *          // customerId; null when neither exists.
 *
 *      Why: the assistant flow binds the customer to the CONVERSATION and the
 *      CONTRACT only (bind-conversation-customer/mod.ts:43-49), and the
 *      SMS-only send path never backfills quote.customerId (send-contract
 *      /mod.ts:116-130 gates the backfill on `wantEmail`). So after the
 *      customer accepts, list-active-jobs classifies the quote WON but then
 *      drops the job because it resolves the customer from quote.customerId
 *      alone. Verified live (2026-08-19): quote w/o customerId + draft
 *      contract carrying customerId + POST /quotes/:id/accept → GET /jobs [].
 *
 * Wiring sites for the green agent (all verified by reading the prod source):
 *   - backend/src/analytics/domain/coordinators/list-active-jobs/mod.ts:97-98
 *       `const customer = q.customerId ? customerById.get(q.customerId) :
 *        undefined; if (!customer) continue;` — swap in
 *       resolveJobCustomerId(q, contract) so the agreement's customer link
 *       keeps the freshly won job visible (UX-02's `/api/jobs → []`).
 *   - backend/src/agents/domain/coordinators/send-contract/mod.ts:116-130
 *       the quote customerId/sent backfill runs only `if (quoteId && wantEmail)`
 *       — the "Enviar por texto" path skips it entirely.
 *   - backend/src/analytics/domain/coordinators/compute-dashboard-stats/mod.ts:82-84
 *       quotedValueCents sums ONLY `status === "sent"` quotes; nothing sums the
 *       won value. Compute the won bucket (aggregatePipeline(...).wonCents) and
 *       expose it as `wonValueCents` on GET /analytics/dashboard
 *       (backend/src/analytics/dto/dashboard-stats.ts:75-77 — the DTO has
 *       quotedValueCents/awaitingResponse and NO won field today).
 *   - front-end/islands/DashboardPage.tsx:295-311 (pickKpis) +
 *     front-end/components/DashSections.tsx:125-196 (Kpis) — no KPI/panel
 *     renders the won value; DashSections.tsx:281-295 renders the
 *     activeJobs empty state ("En cuanto un cliente firme…") off jobs.length,
 *     and :371-375 renders quotesAwaiting.empty ("Aún no hay cotizaciones
 *     enviadas…") — both false for a user whose first quote was just accepted.
 */
import {
  aggregatePipeline,
  classifyQuoteForPipeline,
  type PipelineAggregate,
  // NEW export contract (does not exist yet — see header). With ts-jest
  // diagnostics off this import compiles and arrives as `undefined`, so the
  // tests below fail red until the green agent adds it.
  // @ts-expect-error — intentional: the export is the contract under test.
  resolveJobCustomerId,
} from "../../shared/quote-flow/pipeline-stats";

// ---------------------------------------------------------------------------
// Fixtures — the audit's exact first-win state: a $3,700 quote the customer
// accepted on /q (status "approved" + acceptedAt) whose auto-created
// agreement is still a DRAFT.
// ---------------------------------------------------------------------------

const ACCEPTED_AT = "2026-08-18T18:00:00.000Z";

const approvedQuote = {
  id: "q-first-win",
  status: "approved",
  acceptedAt: ACCEPTED_AT,
  estimatedTotal: 370_000, // the audit's $3,700 (INTEGER CENTS)
  summary: "Instalación de patio de adoquines",
};

const draftContract = { quoteId: "q-first-win", status: "draft" };

describe("UX-02: an approved quote with a draft auto-contract is a won/active job", () => {
  // [contract-pin — GREEN on purpose] The audit hypothesized "the draft
  // contract appears to disqualify it from won/job classification". The
  // shared classifier already gets this right (probe 2026-08-19: the same
  // state seeded WITH quote.customerId yields a /jobs entry) — pin it so the
  // green agent's rewiring can never regress the classification itself. The
  // actual reds live in the two describes below and in the integration file.
  it("UX-02: [contract-pin] classifyQuoteForPipeline: approved + DRAFT agreement → won", () => {
    expect(classifyQuoteForPipeline(approvedQuote, draftContract)).toBe("won");
  });

  it("UX-02: [contract-pin] aggregatePipeline: the accepted quote is 1 won / 1 active job, not awaiting", () => {
    const agg = aggregatePipeline([approvedQuote], [draftContract]);
    expect(agg.wonCount).toBe(1);
    expect(agg.activeJobs).toBe(1);
    expect(agg.awaitingCount).toBe(0);
    expect(agg.awaitingCents).toBe(0);
  });
});

describe("UX-02: the win's $3,700 lands in a won bucket — it must not vanish", () => {
  // Access the NEW field through a widening cast: PipelineAggregate has no
  // wonCents yet, and that absence is exactly the red.
  const wonCentsOf = (agg: PipelineAggregate): number | undefined =>
    (agg as PipelineAggregate & { wonCents?: number }).wonCents;

  it("UX-02: aggregatePipeline exposes wonCents = 370000 for the accepted quote", () => {
    // Today: `wonCents` is undefined — the accepted value appears in NO
    // aggregate (awaitingCents correctly drops to 0, and nothing picks the
    // $3,700 up). Desired: a won/por-facturar bucket in INTEGER cents.
    const agg = aggregatePipeline([approvedQuote], [draftContract]);
    expect(wonCentsOf(agg)).toBe(370_000);
  });

  it("UX-02: wonCents stays integer cents when several wins sum", () => {
    const second = {
      id: "q-second-win",
      status: "approved",
      acceptedAt: ACCEPTED_AT,
      estimatedTotal: 85_030,
      summary: "Reparación de cerca",
    };
    const agg = aggregatePipeline(
      [approvedQuote, second],
      [draftContract, { quoteId: "q-second-win", status: "draft" }],
    );
    expect(wonCentsOf(agg)).toBe(455_030);
    expect(Number.isInteger(wonCentsOf(agg))).toBe(true);
  });

  it("UX-02: a sample quote contributes NOTHING to wonCents (P-15 discipline)", () => {
    const acceptedSample = {
      id: "q-sample",
      status: "approved",
      acceptedAt: ACCEPTED_AT,
      summary: "onboarding-sample-v1 · Paver Patio Installation",
      estimatedTotal: 370_000,
    };
    const agg = aggregatePipeline([acceptedSample]);
    expect(wonCentsOf(agg)).toBe(0);
  });
});

describe("UX-02: job customer resolution falls back to the agreement's customer link", () => {
  it("UX-02: resolveJobCustomerId is exported from pipeline-stats", () => {
    // Red today: the export doesn't exist (undefined). This is the seam the
    // green agent wires into list-active-jobs/mod.ts:97-98 so the assistant's
    // SMS-sent, contract-linked win still renders as a job.
    expect(typeof resolveJobCustomerId).toBe("function");
  });

  it("UX-02: contract.customerId keeps the job when the quote has no link (the assistant shape)", () => {
    expect(
      resolveJobCustomerId(
        { customerId: undefined },
        { customerId: "cust-maria", status: "draft" },
      ),
    ).toBe("cust-maria");
  });

  it("UX-02: the quote's own link wins when present; null when neither exists", () => {
    expect(
      resolveJobCustomerId(
        { customerId: "cust-direct" },
        { customerId: "cust-other" },
      ),
    ).toBe("cust-direct");
    expect(resolveJobCustomerId({}, null)).toBe(null);
    expect(resolveJobCustomerId({}, undefined)).toBe(null);
  });
});
