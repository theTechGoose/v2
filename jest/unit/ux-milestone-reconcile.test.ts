/**
 * RED (TDD) — UX-36 "Signing the contract after the job was invoiced and
 * paid DOUBLE-BILLS the customer."
 *
 * Live repro (ux-problems.md, re-proved over HTTP on 2026-08-19 against the
 * dev stack): quote accepted on /q → contractor invoices $3,700 (370000¢) →
 * customer claims → contractor confirms (invoice `paid`) → customer signs the
 * still-live /c link → the sign coordinator auto-creates the 50/50 milestone
 * plan ANYWAY: +$1,850 `sent` (1/2) and +$1,850 `scheduled` (2/2). The deal
 * now carries 740000¢ of non-void invoices on a 370000¢ agreement.
 *
 * Target: shared/quote-flow/milestone-reconcile.ts   (NEW module — this suite
 * is red today with "Cannot find module"; that is the intended TDD red.)
 *
 * Expected exports:
 *
 *   export interface ExistingInvoiceLike {
 *     amount?: number;   // INTEGER CENTS
 *     status?: string;   // "draft"|"sent"|"viewed"|"claimed"|"scheduled"|"paid"|"void"|"canceled"
 *   }
 *
 *   export function billedTotalCents(
 *     existing: readonly ExistingInvoiceLike[],
 *   ): number
 *     — cents already committed against the agreement. EVERY invoice that is
 *       not status "void"/"canceled" counts (paid, claimed, sent, viewed,
 *       scheduled, draft — a draft will be sent, so it blocks re-billing
 *       too). Missing `amount` counts as 0.
 *
 *   export function reconcileMilestones(
 *     plannedCents: readonly number[],       // computePaymentSplit output, in cents
 *     agreementTotalCents: number,
 *     existing: readonly ExistingInvoiceLike[],
 *   ): number[]
 *     — the amounts that may STILL be invoiced, in plan order:
 *       • nothing billed              → the plan unchanged;
 *       • fully billed (billed ≥ total) → [] (NO new invoices — the UX-36 case);
 *       • partially billed            → milestones consumed FROM THE FRONT:
 *         subtract `billed` from planned[0], then planned[1], … ; milestones
 *         reduced to 0 are dropped. Invariant: sum(result) ===
 *         max(0, agreementTotalCents - billedTotalCents(existing)).
 *
 * Wiring sites (for the green agent — read on 2026-08-19):
 *   - backend/src/paperwork/domain/coordinators/send-signed-confirmation/mod.ts
 *     :136-137 — `const total = contract.totalAmount ?? 0;` +
 *     `const milestoneAmounts = computeMilestoneAmounts(total, contract.terms);`
 *     then the creation loop at :139-185 (`this.invoices.create` at :164)
 *     bills the FULL plan unconditionally. The coordinator already injects
 *     `private invoices: InvoiceStore` (:69): load the deal's existing
 *     invoices (listByUser(userId) filtered by
 *     `i.contractId === contract.id || i.quoteId === contract.quoteId`) and
 *     pass `milestoneAmounts` through `reconcileMilestones(...)` before the
 *     loop. `computeMilestoneAmounts` itself (:399-405, delegating to
 *     front-end/lib/payment-split.ts computePaymentSplit) stays untouched —
 *     the plan is right, billing it twice is the bug.
 *   - Triggered from POST /contracts/:id/sign —
 *     backend/src/paperwork/entrypoints/public-controller/mod.ts:772
 *     (`this.signedConfirmation.run(updated.id)` inside signContract
 *     :727-780).
 *
 * Phones: none (pure logic — no network).
 */
import {
  billedTotalCents,
  reconcileMilestones,
} from "../../shared/quote-flow/milestone-reconcile";

// The exact live-repro numbers: $3,700 agreement, "50 / 50" terms.
const TOTAL = 370000;
const PLAN_50_50 = [185000, 185000];

describe("UX-36 reconcileMilestones — the milestone plan bills only the unbilled remainder", () => {
  it("UX-36 a fully-PAID deal creates NO new invoices (the live double-billing repro)", () => {
    const existing = [{ amount: 370000, status: "paid" }];
    expect(reconcileMilestones(PLAN_50_50, TOTAL, existing)).toEqual([]);
  });

  it("UX-36 a fully-BILLED (sent, unpaid) deal also creates no new invoices", () => {
    // Billing is the commitment — the customer already holds a bill for the
    // whole job; whether the money landed yet is irrelevant to re-billing.
    const existing = [{ amount: 370000, status: "sent" }];
    expect(reconcileMilestones(PLAN_50_50, TOTAL, existing)).toEqual([]);
  });

  it("UX-36 nothing billed → the normal split, unchanged", () => {
    expect(reconcileMilestones(PLAN_50_50, TOTAL, [])).toEqual([185000, 185000]);
  });

  it("UX-36 partial billing consumes milestones from the front (remainder only)", () => {
    // $1,000 already invoiced → first milestone shrinks; second is intact.
    const existing = [{ amount: 100000, status: "paid" }];
    expect(reconcileMilestones(PLAN_50_50, TOTAL, existing)).toEqual([
      85000,
      185000,
    ]);
  });

  it("UX-36 a fully-consumed milestone is dropped, not emitted as $0", () => {
    // Exactly the first 50% already billed → only the completion half remains.
    const existing = [{ amount: 185000, status: "paid" }];
    expect(reconcileMilestones(PLAN_50_50, TOTAL, existing)).toEqual([185000]);
  });

  it("UX-36 partial billing that spans milestones leaves one shrunken tail", () => {
    const existing = [{ amount: 250000, status: "paid" }];
    expect(reconcileMilestones(PLAN_50_50, TOTAL, existing)).toEqual([120000]);
  });

  it("UX-36 the remainder invariant holds: sum(result) === total - billed", () => {
    for (const billed of [0, 1, 50000, 185000, 269999, 370000]) {
      const out = reconcileMilestones(PLAN_50_50, TOTAL, [
        { amount: billed, status: "sent" },
      ]);
      const sum = out.reduce((a, b) => a + b, 0);
      expect(sum).toBe(Math.max(0, TOTAL - billed));
    }
  });

  it("UX-36 over-billing never goes negative — result is simply []", () => {
    const existing = [
      { amount: 370000, status: "paid" },
      { amount: 50000, status: "sent" },
    ];
    expect(reconcileMilestones(PLAN_50_50, TOTAL, existing)).toEqual([]);
  });

  it("UX-36 void/canceled invoices free their amount (they don't block billing)", () => {
    const existing = [
      { amount: 370000, status: "void" },
      { amount: 12300, status: "canceled" },
    ];
    expect(reconcileMilestones(PLAN_50_50, TOTAL, existing)).toEqual([
      185000,
      185000,
    ]);
  });

  it("UX-36 a 30/30/40 plan reconciles the same way (one milestone already billed)", () => {
    const plan = [111000, 111000, 148000];
    const existing = [{ amount: 111000, status: "paid" }];
    expect(reconcileMilestones(plan, TOTAL, existing)).toEqual([
      111000,
      148000,
    ]);
  });
});

describe("UX-36 billedTotalCents — what counts as already billed", () => {
  it("UX-36 sums every non-void/non-canceled invoice; missing amount is 0", () => {
    expect(
      billedTotalCents([
        { amount: 370000, status: "paid" },
        { amount: 5000, status: "void" },
        { amount: 7000, status: "canceled" },
        { status: "sent" }, // no amount → 0
      ]),
    ).toBe(370000);
  });

  it("UX-36 drafts and scheduled placeholders count too (they will be sent)", () => {
    expect(
      billedTotalCents([
        { amount: 10000, status: "draft" },
        { amount: 20000, status: "scheduled" },
        { amount: 30000, status: "claimed" },
      ]),
    ).toBe(60000);
  });

  it("UX-36 an empty deal has nothing billed", () => {
    expect(billedTotalCents([])).toBe(0);
  });
});
