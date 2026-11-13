/**
 * REQ-233 (demo issue B2) — one $2,400 job was billed $4,800: signing the
 * 50/50 quote created the deposit + balance invoices ($1,200 + $1,200), then
 * the assistant's "Send as Invoice" swap minted a THIRD invoice for the full
 * $2,400. Nothing compared a new quote-linked invoice with what was already
 * billed against the agreement.
 *
 * The pure rule, in shared/documents/ledger.ts (next to the REQ-205 ledger
 * whose "remaining to invoice" it reuses):
 *
 *   invoiceCapDecision(quote, invoices, changeOrders, requestedCents)
 *     → { ok: true, remainingCents }
 *     | { ok: false, reason: "exceeds_agreement", agreementTotalCents,
 *         invoicedCents, remainingCents, requestedCents }
 *
 *   swapInvoiceCents(totalCents, remainingCents) → number | null
 *     — what the assistant's Quote ⇄ Invoice swap may bill: the unbilled
 *       remainder (never more than the total), null when nothing is left.
 *
 * Tax is not part of the agreed price: an invoice's taxCents is left out of
 * both the request and the billed sum.
 *
 * Lazy-required so a missing export reds only the tests that use it.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ledger = () => require("../../shared/documents/ledger");

const QUOTE = { id: "q1", estimatedTotal: 240000, status: "accepted" };
const MILESTONES = [
  { id: "i1", amount: 120000, status: "sent", installmentIndex: 1 },
  { id: "i2", amount: 120000, status: "scheduled", installmentIndex: 2 },
];

describe("REQ-233 invoiceCapDecision — a quote-linked invoice never bills past the agreement", () => {
  it("REQ-233 B2: a signed 50/50 $2,400 quote refuses a third, full-amount $2,400 invoice", () => {
    const d = ledger().invoiceCapDecision(QUOTE, MILESTONES, [], 240000);
    expect(d).toEqual({
      ok: false,
      reason: "exceeds_agreement",
      agreementTotalCents: 240000,
      invoicedCents: 240000,
      remainingCents: 0,
      requestedCents: 240000,
    });
  });

  it("REQ-233 invoice-first: an un-billed quote takes the full amount", () => {
    const d = ledger().invoiceCapDecision(QUOTE, [], [], 240000);
    expect(d).toEqual({ ok: true, remainingCents: 240000 });
  });

  it("REQ-233 a partial bill leaves exactly the remainder open", () => {
    const one = [MILESTONES[0]];
    expect(ledger().invoiceCapDecision(QUOTE, one, [], 120000).ok).toBe(true);
    expect(ledger().invoiceCapDecision(QUOTE, one, [], 120001).ok).toBe(false);
  });

  it("REQ-233 void and canceled invoices free their amount", () => {
    const voided = MILESTONES.map((i) => ({ ...i, status: "void" }));
    expect(ledger().invoiceCapDecision(QUOTE, voided, [], 240000).ok).toBe(
      true,
    );
  });

  it("REQ-233 approved change orders raise the agreed total; pending ones do not", () => {
    const cos = [
      { id: "c1", deltaAmountCents: 50000, status: "approved" },
      { id: "c2", deltaAmountCents: 90000, status: "pending" },
    ];
    expect(ledger().invoiceCapDecision(QUOTE, MILESTONES, cos, 50000).ok).toBe(
      true,
    );
    expect(ledger().invoiceCapDecision(QUOTE, MILESTONES, cos, 50001).ok).toBe(
      false,
    );
  });

  it("REQ-233 tax is not part of the agreed price — on the request or on the billed sum", () => {
    // $1,200 + 8.25% tax on the first milestone; the second may still be $1,200 + tax
    const taxed = [{
      id: "i1",
      amount: 129900,
      taxCents: 9900,
      status: "sent",
    }];
    expect(
      ledger().invoiceCapDecision(QUOTE, taxed, [], 129900, 9900).ok,
    ).toBe(true);
  });

  it("REQ-233 a quote with no agreed price is not capped", () => {
    const d = ledger().invoiceCapDecision({ id: "q2" }, [], [], 99900);
    expect(d.ok).toBe(true);
  });
});

describe("REQ-233 swapInvoiceCents — the assistant's Quote ⇄ Invoice swap bills only what is left", () => {
  it("REQ-233 nothing billed → the full total", () => {
    expect(ledger().swapInvoiceCents(240000, 240000)).toBe(240000);
  });
  it("REQ-233 B2: fully billed → null (no third invoice)", () => {
    expect(ledger().swapInvoiceCents(240000, 0)).toBeNull();
  });
  it("REQ-233 partly billed → the remainder, never more than the total", () => {
    expect(ledger().swapInvoiceCents(240000, 120000)).toBe(120000);
    expect(ledger().swapInvoiceCents(240000, 300000)).toBe(240000);
  });
});

describe("REQ-233 isExceedsAgreement — the cap's 409 reads as a plain sentence, not 'POST /invoices failed: 409'", () => {
  it("REQ-233 matches the cap's 409 and nothing else", () => {
    const { isExceedsAgreement } = ledger();
    expect(
      isExceedsAgreement({
        status: 409,
        body: { reason: "exceeds_agreement" },
      }),
    ).toBe(true);
    expect(
      isExceedsAgreement({ status: 409, body: { reason: "locked_paid" } }),
    ).toBe(false);
    expect(isExceedsAgreement(new Error("boom"))).toBe(false);
    expect(isExceedsAgreement(null)).toBe(false);
  });
});
