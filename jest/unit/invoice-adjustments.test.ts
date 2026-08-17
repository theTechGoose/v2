/**
 * PDF p6 + p18 (Invoices — "This is not working.") — invoices must be
 * adjustable through a DISCOUNT or a CHANGE ORDER. A change order triggers a
 * NEW approval link (/co/<id>) that the customer ("the Unicorn") must
 * approve before it takes effect.
 *
 * Vocabulary matches the shipped DTOs (invoice `amount` in integer cents,
 * discount `discountCents` with clamp-at-zero, change-order
 * { description, deltaAmountCents }). All-data-is-immutable per project
 * convention: adjustments return new objects; the input is never mutated.
 * Target: shared/quote-flow/invoice-adjustments.ts
 */
import {
  applyChangeOrder,
  applyDiscount,
  createChangeOrder,
} from "../../shared/quote-flow/invoice-adjustments";

const invoice = {
  id: "inv1",
  jobName: "Backyard Junk Removal",
  lineItems: [
    { description: "Junk removal", quantity: 1, unit: "job", price: 55000 },
  ],
  amount: 55000,
};

describe("applyDiscount", () => {
  it("reduces the amount by the discount", () => {
    const out = applyDiscount(invoice, { discountCents: 5000, reason: "repeat client" });
    expect(out.amount).toBe(50000);
    expect(out.discountCents).toBe(5000);
  });

  it("records the discount visibly, preserving the original line items", () => {
    const out = applyDiscount(invoice, { discountCents: 5000, reason: "repeat client" });
    expect(out.lineItems).toEqual(invoice.lineItems);
    expect(out.discountReason).toMatch(/repeat client/i);
  });

  it("never mutates the input invoice (immutability)", () => {
    const before = JSON.stringify(invoice);
    applyDiscount(invoice, { discountCents: 5000 });
    expect(JSON.stringify(invoice)).toBe(before);
  });

  it("clamps an oversized discount at zero — never a negative amount", () => {
    const out = applyDiscount(invoice, { discountCents: 999999 });
    expect(out.amount).toBe(0);
  });

  it("rejects a non-positive discount", () => {
    expect(() => applyDiscount(invoice, { discountCents: 0 })).toThrow();
    expect(() => applyDiscount(invoice, { discountCents: -100 })).toThrow();
  });
});

describe("createChangeOrder", () => {
  it("creates a pending change order tied to the invoice", () => {
    const co = createChangeOrder(invoice, {
      description: "Haul extra debris",
      deltaAmountCents: 15000,
    });
    expect(co.status).toBe("pending");
    expect(co.invoiceId).toBe("inv1");
    expect(co.id).toBeTruthy();
  });

  it("each change order is its own approval target — a NEW /co/<id> link each time", () => {
    const a = createChangeOrder(invoice, { description: "A", deltaAmountCents: 1000 });
    const b = createChangeOrder(invoice, { description: "B", deltaAmountCents: 2000 });
    expect(a.id).not.toBe(b.id);
    expect(a.approvalPath).toBe(`/co/${a.id}`);
    expect(b.approvalPath).toBe(`/co/${b.id}`);
  });
});

describe("applyChangeOrder", () => {
  it("refuses to apply a change order the customer has not approved", () => {
    const co = createChangeOrder(invoice, {
      description: "Extra",
      deltaAmountCents: 15000,
    });
    expect(() => applyChangeOrder(invoice, co)).toThrow(/approv/i);
  });

  it("applies an approved change order to the amount", () => {
    const co = {
      ...createChangeOrder(invoice, { description: "Extra", deltaAmountCents: 15000 }),
      status: "approved" as const,
    };
    const out = applyChangeOrder(invoice, co);
    expect(out.amount).toBe(70000);
  });

  it("a declined change order never alters the invoice", () => {
    const co = {
      ...createChangeOrder(invoice, { description: "Extra", deltaAmountCents: 15000 }),
      status: "declined" as const,
    };
    expect(() => applyChangeOrder(invoice, co)).toThrow();
  });
});
