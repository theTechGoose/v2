/**
 * REQ-981 (LOOP-007 cycle 1, q1-62) — a discount bigger than the bill.
 * The New invoice form showed "Subtotal $0.00 / Discount −$100.00 / Tax $0.00
 * / Total $0.00": computeTotals floors the taxable amount at zero but returns
 * the discount as typed, so the shown lines don't add up and buildInvoiceBody
 * posts (and the backend stores, emails and prints) a discount larger than the
 * subtotal. The discount must never exceed the subtotal.
 *   shared/documents/invoice-form.ts
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mod = () => require("../../shared/documents/invoice-form");

const FORM_BASE = {
  jobName: "Fence",
  description: "",
  lineItems: [] as Array<
    { description: string; quantity: number; price: number }
  >,
  discountReason: "",
  taxRateBp: 0,
  netDays: 15,
  issuedDate: "2026-11-18",
  serviceAddress: "",
  paymentInstructions: "",
  billTo: {
    name: "Ann",
    businessName: "",
    email: "",
    phoneNumber: "",
    address: "",
  },
};

/** small deterministic PRNG so a failure is reproducible */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("REQ-981 q1-62 discount never exceeds the subtotal", () => {
  it("REQ-981 q1-62 computeTotals: no amount + Discount $100 → discount line is $0, not −$100", () => {
    const { computeTotals } = mod();
    const t = computeTotals({
      lineItems: [],
      amountCents: 0,
      discountCents: 10000,
    });
    expect(t.subtotalCents).toBe(0);
    expect(t.discountCents).toBe(0);
    expect(t.totalCents).toBe(0);
  });

  it("REQ-981 q1-62 computeTotals: $50 amount + $100 discount at 8.25% → discount capped at $50, total $0", () => {
    const { computeTotals } = mod();
    const t = computeTotals({
      lineItems: [],
      amountCents: 5000,
      discountCents: 10000,
      taxRateBp: 825,
    });
    expect(t.subtotalCents).toBe(5000);
    expect(t.discountCents).toBe(5000);
    expect(t.taxCents).toBe(0);
    expect(t.totalCents).toBe(0);
  });

  it("REQ-981 q1-62 computeTotals: line items $5 with a $9 discount → discount capped at $5", () => {
    const { computeTotals } = mod();
    const t = computeTotals({
      lineItems: [{ description: "x", quantity: 1, price: 500 }],
      discountCents: 900,
    });
    expect(t.discountCents).toBe(500);
  });

  it("REQ-981 q1-62 computeTotals: subtotal − discount + tax === total, and discount ≤ subtotal, for random inputs", () => {
    const { computeTotals } = mod();
    const r = rng(981);
    const bad: unknown[] = [];
    for (let i = 0; i < 500; i++) {
      const amountCents = Math.floor(r() * 20000);
      const discountCents = Math.floor(r() * 30000);
      const taxRateBp = Math.floor(r() * 1500);
      const t = computeTotals({
        lineItems: [],
        amountCents,
        discountCents,
        taxRateBp,
      });
      const adds = t.subtotalCents - t.discountCents + t.taxCents ===
        t.totalCents;
      if (!adds || t.discountCents > t.subtotalCents) {
        bad.push({ amountCents, discountCents, taxRateBp, t });
      }
    }
    expect(bad.slice(0, 3)).toEqual([]);
  });

  it("REQ-981 q1-62 buildInvoiceBody never posts discountCents larger than subtotalCents", () => {
    const { buildInvoiceBody } = mod();
    const noAmount = buildInvoiceBody(
      { ...FORM_BASE, amountCents: 0, discountCents: 10000 },
      { requestId: "r-981a", status: "sent" },
    );
    expect(noAmount.subtotalCents).toBe(0);
    expect((noAmount.discountCents as number | undefined) ?? 0)
      .toBeLessThanOrEqual(noAmount.subtotalCents as number);

    const half = buildInvoiceBody(
      { ...FORM_BASE, amountCents: 5000, discountCents: 10000, taxRateBp: 825 },
      { requestId: "r-981b", status: "sent" },
    );
    expect(half.subtotalCents).toBe(5000);
    expect(half.discountCents).toBe(5000);
    expect(half.amount).toBe(0);
  });
});
