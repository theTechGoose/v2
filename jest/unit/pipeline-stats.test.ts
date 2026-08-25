/**
 * Pipeline stats truth — RED (TDD) tests for problems.md:
 *
 *   P-14 "The user's first quote is misreported as WON. Minutes after sending
 *        (nobody signed), /quotes shows it under 'Decididas este mes — 1
 *        ganadas' … Desired: a sent-but-unsigned quote counts as AWAITING …
 *        NOT decided/won, and NOT an active job; the two pages agree."
 *   P-15 "The onboarding sample quote pollutes real pipeline stats. …
 *        Desired: sample quotes are excluded from ALL pipeline/money
 *        aggregates and open-tracking …"
 *   P-36 "Money numbers contradict across pages. … aging bucket 'Current
 *        $0.01' (visible one-cent artifact) … '$850' displayed as '$0.8k';
 *        '1 activos'; 'Vence Sin fecha de vencimiento' run-on."
 *
 * Target module: shared/quote-flow/pipeline-stats.ts
 *
 * Post Quote+Contract merge there is NO contract entity: the quote carries
 * its own acceptance, so the classifier and aggregator take ONE argument.
 *
 * Exports under test:
 *
 *   export type PipelineClass = "awaiting" | "won" | "lost" | "draft";
 *   export function classifyQuoteForPipeline(
 *     quote: { status?: string; sentAt?: string | null; acceptedAt?: string | null;
 *              lostAt?: string | null },
 *   ): PipelineClass;
 *     // sent + unsigned (drafted terms on the quote change nothing) → "awaiting"
 *     // acceptedAt / status accepted → "won"
 *     // lostAt / status lost → "lost"; never sent → "draft"
 *
 *   export function aggregatePipeline(
 *     quotes: Array<{ id: string; status?: string; sentAt?: string | null;
 *                     acceptedAt?: string | null; lostAt?: string | null;
 *                     estimatedTotal?: number | null; summary?: string | null;
 *                     isSample?: boolean }>,
 *   ): {
 *     totalQuotes: number;       // real (non-sample) quotes only
 *     draftCount: number;
 *     awaitingCount: number;
 *     awaitingCents: number;     // INTEGER cents out with customers
 *     wonCount: number;          // signed/accepted only
 *     lostCount: number;
 *     decidedCount: number;      // wonCount + lostCount
 *     activeJobs: number;        // signed/accepted only — a sent quote is NOT a job
 *   };
 *     // Sample quotes (isSample === true OR summary starting with
 *     // "onboarding-sample") contribute to NOTHING.
 *
 *   export function formatMoneyCompact(cents: number): string;
 *     // ≥ $1,000 may compact ("$1.4k"); BELOW $1k always the full amount
 *     // ("$850", never "$0.8k"); sub-dollar rounds to "$0" (never "$0.01").
 *
 *   export function dueDateLine(
 *     invoice: { dueDate?: string | null }, lang: "en" | "es",
 *   ): string;
 *     // Missing dueDate → ONE clean phrase ("Sin fecha de vencimiento" /
 *     // "No due date"), never the "Vence Sin fecha de vencimiento" /
 *     // "Due No due date" run-on. With a date → "Vence …" / "Due …".
 *
 *   export function activeJobsCountLabel(n: number, lang: "en" | "es"): string;
 *     // es: "1 activo" / "2 activos" (never "1 activos"); en: "{n} active".
 *
 * Wiring sites for the green agent (where today's bugs live):
 *   - backend/src/analytics/domain/coordinators/build-quote-cards/mod.ts:117
 *       `if (contractsByQuoteId.has(quoteId)) return "won";` — an UNSIGNED
 *       draft agreement flips the card stage to "won" (P-14).
 *   - backend/src/analytics/domain/coordinators/compute-quote-win-rate/mod.ts:29-41
 *       `wonViaContract` counts ANY contract referencing the quote as won (P-14).
 *   - backend/src/analytics/domain/coordinators/list-active-jobs/mod.ts:80
 *       includes `q.status === "sent"` quotes as active jobs (P-14).
 *   - backend/src/analytics/domain/coordinators/compute-dashboard-stats/mod.ts:53-80
 *       quoteCounts / quotedValueCents have no sample exclusion (P-15).
 *   - backend/src/agents/domain/coordinators/ensure-sample-quote/mod.ts:15
 *       SAMPLE_TAG = "onboarding-sample-v1" (summary prefix; no isSample flag yet).
 *   - front-end/components/DashSections.tsx:171
 *       `(props.pendingTotal / 1000).toFixed(1)` + lang "kpis.quotesPending.inFlight"
 *       = "${amt}k …" → renders "$0.8k" for $850 (P-36).
 *   - front-end/islands/DashboardPage.tsx:48-62 (fmtDue) +
 *     front-end/components/DashSections.tsx:285 (`activeJobs.due` = "Vence {due}") +
 *     lang "dashboardPage.due.none" ("Sin fecha de vencimiento" / "No due date")
 *       → "Vence Sin fecha de vencimiento" run-on (P-36).
 *   - front-end/components/DashSections.tsx:253 (`activeJobs.count` = "{n} activos")
 *       → "1 activos" (P-36).
 */
import {
  activeJobsCountLabel,
  aggregatePipeline,
  classifyQuoteForPipeline,
  dueDateLine,
  formatMoneyCompact,
} from "../../shared/quote-flow/pipeline-stats";

// ---------------------------------------------------------------------------
// Fixtures — mirror the real backend shapes (integer cents, ISO timestamps).
// ---------------------------------------------------------------------------

const SENT_AT = "2026-08-18T10:00:00.000Z";

const sentQuote = {
  id: "q-sent",
  status: "sent",
  sentAt: SENT_AT,
  estimatedTotal: 85_000, // $850
  summary: "Fence repair",
};

const acceptedQuote = {
  id: "q-won",
  status: "accepted",
  sentAt: SENT_AT,
  acceptedAt: "2026-08-18T12:00:00.000Z",
  estimatedTotal: 90_000,
  summary: "Deck build",
};

const lostQuote = {
  id: "q-lost",
  status: "lost",
  sentAt: SENT_AT,
  lostAt: "2026-08-18T12:00:00.000Z",
  estimatedTotal: 40_000,
  summary: "Gutter cleaning",
};

const draftQuote = {
  id: "q-draft",
  status: "draft",
  estimatedTotal: 12_000,
  summary: "Shed paint",
};

// Exactly what EnsureSampleQuote persists today (backend/src/agents/domain/
// coordinators/ensure-sample-quote/mod.ts): summary-tagged, status "sent",
// $3,700 in cents. No customer, never emailed.
const sampleQuote = {
  id: "q-sample",
  status: "sent",
  summary: "onboarding-sample-v1 · Paver Patio Installation",
  estimatedTotal: 370_000,
};

describe("P-14 classifyQuoteForPipeline — sent-but-unsigned is AWAITING, never won", () => {
  it("P-14 a sent quote is awaiting until somebody signs", () => {
    expect(classifyQuoteForPipeline(sentQuote)).toBe("awaiting");
  });

  it("P-14 a sent quote with drafted terms on it is still awaiting — not won", () => {
    // The merged analogue of the audit's first-quote state: the terms wizard
    // wrote the agreement terms ONTO the quote, nobody signed. Drafted terms
    // are not a signature.
    expect(
      classifyQuoteForPipeline({
        ...sentQuote,
        terms: [
          { stepId: "payment_terms", label: "Payment terms", value: "50 / 50" },
        ],
      }),
    ).toBe("awaiting");
  });

  it("P-14 the dead legacy 'approved' status is NOT a win (single canonical 'accepted')", () => {
    expect(classifyQuoteForPipeline({ ...sentQuote, status: "approved" }))
      .toBe("awaiting");
  });

  it("P-14 the canonical 'accepted' status alone makes it won", () => {
    expect(
      classifyQuoteForPipeline({ ...sentQuote, status: "accepted" }),
    ).toBe("won");
  });

  it("P-14 a customer-accepted quote (acceptedAt stamp) is won", () => {
    expect(classifyQuoteForPipeline(acceptedQuote)).toBe("won");
  });

  it("P-14 a lost quote is lost", () => {
    expect(classifyQuoteForPipeline(lostQuote)).toBe("lost");
  });

  it("P-14 a never-sent quote is a draft", () => {
    expect(classifyQuoteForPipeline(draftQuote)).toBe("draft");
  });

  it("P-14 aggregatePipeline: sent + unsigned → 1 awaiting with its $850, 0 won, 0 active jobs", () => {
    const agg = aggregatePipeline([sentQuote]);
    expect(agg.awaitingCount).toBe(1);
    expect(agg.awaitingCents).toBe(85_000);
    expect(agg.wonCount).toBe(0);
    expect(agg.decidedCount).toBe(0);
    expect(agg.activeJobs).toBe(0);
  });

  it("P-14 aggregatePipeline: only an acceptance creates a won + active job", () => {
    const agg = aggregatePipeline([acceptedQuote]);
    expect(agg.wonCount).toBe(1);
    expect(agg.decidedCount).toBe(1);
    expect(agg.activeJobs).toBe(1);
    expect(agg.awaitingCount).toBe(0);
    expect(agg.awaitingCents).toBe(0);
  });
});

describe("P-15 aggregatePipeline — sample quotes contribute to NOTHING", () => {
  it("P-15 only the onboarding sample present → every aggregate is zero", () => {
    const agg = aggregatePipeline([sampleQuote]);
    expect(agg.totalQuotes).toBe(0);
    expect(agg.draftCount).toBe(0);
    expect(agg.awaitingCount).toBe(0);
    expect(agg.awaitingCents).toBe(0); // NOT the sample's $3,700
    expect(agg.wonCount).toBe(0);
    expect(agg.lostCount).toBe(0);
    expect(agg.decidedCount).toBe(0);
    expect(agg.activeJobs).toBe(0);
  });

  it("P-15 an isSample-flagged quote is excluded even without the slug", () => {
    const flagged = {
      id: "q-flag",
      status: "sent",
      sentAt: SENT_AT,
      estimatedTotal: 100_000,
      summary: "Sample job",
      isSample: true,
    };
    const agg = aggregatePipeline([flagged]);
    expect(agg.totalQuotes).toBe(0);
    expect(agg.awaitingCount).toBe(0);
    expect(agg.awaitingCents).toBe(0);
  });

  it("P-15 a real quote next to the sample: only the real one counts", () => {
    const agg = aggregatePipeline([sampleQuote, sentQuote]);
    expect(agg.totalQuotes).toBe(1);
    expect(agg.awaitingCount).toBe(1);
    expect(agg.awaitingCents).toBe(85_000); // $850, not $850 + $3,700
    expect(agg.wonCount).toBe(0);
  });
});

describe("P-36 money formatting, integer-cents aggregation, due line, pluralization", () => {
  it("P-36 formatMoneyCompact renders sub-$1k amounts in full — $850, never $0.8k", () => {
    expect(formatMoneyCompact(85_000)).toBe("$850");
  });

  it("P-36 formatMoneyCompact keeps $999 un-compacted", () => {
    expect(formatMoneyCompact(99_900)).toBe("$999");
  });

  it("P-36 formatMoneyCompact never emits a fractional-cent display for stray cents", () => {
    // The dashboard aging bucket showed "Current $0.01" — a one-cent
    // artifact surfaced verbatim. Stray sub-dollar cents round to "$0".
    expect(formatMoneyCompact(1)).toBe("$0");
    expect(formatMoneyCompact(0)).toBe("$0");
  });

  it("P-36 formatMoneyCompact may compact at ≥ $1k ($1.4k)", () => {
    expect(formatMoneyCompact(1_420_000)).toBe("$1.4k");
  });

  it("P-36 aggregation stays in INTEGER cents — no float drift from 1-cent inputs", () => {
    // Artifact class: summing (cents / 100) dollars gives 0.01 + 0.01 + 0.01
    // = 0.030000000000000002 → 3.0000000000000004 cents → "$0.01"-style
    // displays. Cents must be summed as integers.
    const cents = [1, 1, 1];
    const agg = aggregatePipeline(
      cents.map((c, i) => ({
        id: `q-${i}`,
        status: "sent",
        sentAt: SENT_AT,
        estimatedTotal: c,
        summary: `tiny ${i}`,
      })),
    );
    expect(agg.awaitingCents).toBe(3);
    expect(Number.isInteger(agg.awaitingCents)).toBe(true);
  });

  it("P-36 aggregation of mixed amounts is exact integer cents", () => {
    const agg = aggregatePipeline([
      {
        id: "a",
        status: "sent",
        sentAt: SENT_AT,
        estimatedTotal: 10,
        summary: "a",
      },
      {
        id: "b",
        status: "sent",
        sentAt: SENT_AT,
        estimatedTotal: 20,
        summary: "b",
      },
      {
        id: "c",
        status: "sent",
        sentAt: SENT_AT,
        estimatedTotal: 85_000,
        summary: "c",
      },
    ]);
    expect(agg.awaitingCents).toBe(85_030);
    expect(Number.isInteger(agg.awaitingCents)).toBe(true);
  });

  it("P-36 dueDateLine (es): a due-less invoice is ONE clean phrase, never the run-on", () => {
    const line = dueDateLine({ dueDate: null }, "es");
    expect(line).not.toMatch(/Vence\s+Sin fecha/i); // "Vence Sin fecha de vencimiento"
    expect(line).not.toMatch(/^Vence\b/i);
    expect(line).toMatch(/sin fecha de vencimiento/i);
  });

  it("P-36 dueDateLine (en): a due-less invoice never reads 'Due No due date'", () => {
    const line = dueDateLine({}, "en");
    expect(line).not.toMatch(/Due\s+No due date/i);
    expect(line).not.toMatch(/^Due\b/i);
    expect(line).toMatch(/no due date/i);
  });

  it("P-36 dueDateLine with a real date leads with the due verb", () => {
    expect(dueDateLine({ dueDate: "2026-09-30" }, "es")).toMatch(/^Vence /);
    expect(dueDateLine({ dueDate: "2026-09-30" }, "en")).toMatch(/^Due /);
  });

  it("P-36 activeJobsCountLabel pluralizes Spanish correctly — 1 activo, 2 activos", () => {
    expect(activeJobsCountLabel(1, "es")).toBe("1 activo");
    expect(activeJobsCountLabel(2, "es")).toBe("2 activos");
    expect(activeJobsCountLabel(0, "es")).toBe("0 activos");
  });

  it("P-36 activeJobsCountLabel in English", () => {
    expect(activeJobsCountLabel(1, "en")).toBe("1 active");
    expect(activeJobsCountLabel(3, "en")).toBe("3 active");
  });
});
