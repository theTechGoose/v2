/**
 * REQ-201 / REQ-206 — the standalone invoice form's pure arithmetic and the
 * document headline (number · version · state), in
 *   shared/documents/invoice-form.ts
 * Lazy-required so a missing module reds every test for its own reason.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mod = () => require("../../shared/documents/invoice-form");

const LABELS = {
  draft: "Draft",
  sent: "Sent",
  revised: "Revised invoice — replaces previous version",
  claimed: "Payment claimed",
  paid: "Paid",
  void: "Void",
};

describe("REQ-206 money conversions", () => {
  it("REQ-206 dollarsToCents rounds typed dollars to integer cents and refuses junk", () => {
    const { dollarsToCents } = mod();
    expect(dollarsToCents("12.50")).toBe(1250);
    expect(dollarsToCents("0.1")).toBe(10);
    expect(dollarsToCents(" 1,250.75 ")).toBe(125075);
    expect(dollarsToCents("")).toBe(0);
    expect(dollarsToCents("abc")).toBe(0);
    expect(dollarsToCents("-5")).toBe(0);
  });

  it("REQ-206 centsToDollars renders two decimals for an input value", () => {
    const { centsToDollars } = mod();
    expect(centsToDollars(1250)).toBe("12.50");
    expect(centsToDollars(0)).toBe("0.00");
    expect(centsToDollars(undefined)).toBe("");
  });

  it("REQ-206 percentToBp / bpToPercent — 8.25% is 825 basis points and back", () => {
    const { percentToBp, bpToPercent } = mod();
    expect(percentToBp("8.25")).toBe(825);
    expect(percentToBp("0")).toBe(0);
    expect(percentToBp("")).toBe(0);
    expect(percentToBp("x")).toBe(0);
    expect(bpToPercent(825)).toBe("8.25");
    expect(bpToPercent(700)).toBe("7");
    expect(bpToPercent(0)).toBe("0");
  });
});

describe("REQ-206 totals", () => {
  it("REQ-206 computeTotals sums the lines, takes the discount, taxes the rest", () => {
    const { computeTotals } = mod();
    const t = computeTotals({
      lineItems: [
        { description: "Labor", quantity: 2, price: 15000 },
        { description: "Parts", quantity: 1, price: 4999 },
      ],
      discountCents: 1000,
      taxRateBp: 825,
    });
    expect(t.subtotalCents).toBe(34999);
    expect(t.discountCents).toBe(1000);
    expect(t.taxableCents).toBe(33999);
    expect(t.taxCents).toBe(2805); // 33999 × 8.25% = 2804.92 → 2805
    expect(t.totalCents).toBe(36804);
  });

  it("REQ-206 computeTotals never goes below zero and ignores a missing rate", () => {
    const { computeTotals } = mod();
    const t = computeTotals({
      lineItems: [{ description: "x", quantity: 1, price: 500 }],
      discountCents: 900,
    });
    expect(t.subtotalCents).toBe(500);
    expect(t.taxableCents).toBe(0);
    expect(t.taxCents).toBe(0);
    expect(t.totalCents).toBe(0);
  });

  it("REQ-206 computeTotals with no lines falls back to the typed amount", () => {
    const { computeTotals } = mod();
    const t = computeTotals({
      lineItems: [],
      amountCents: 80000,
      taxRateBp: 0,
    });
    expect(t.subtotalCents).toBe(80000);
    expect(t.totalCents).toBe(80000);
  });
});

describe("REQ-206 payment terms", () => {
  it("REQ-206 dueDateFrom adds netDays to the issue date (calendar days, no DST drift)", () => {
    const { dueDateFrom } = mod();
    expect(dueDateFrom("2026-11-06", 15)).toBe("2026-11-21");
    expect(dueDateFrom("2026-11-06", 0)).toBe("2026-11-06");
    expect(dueDateFrom("2026-12-25", 30)).toBe("2027-01-24");
    expect(dueDateFrom("2026-03-07", 1)).toBe("2026-03-08");
  });

  it("REQ-206 NET_DAYS_OPTIONS are 0 / 7 / 15 / 30", () => {
    const { NET_DAYS_OPTIONS } = mod();
    expect(NET_DAYS_OPTIONS).toEqual([0, 7, 15, 30]);
  });
});

describe("REQ-206 missing info (warns, never blocks)", () => {
  it("REQ-206 lists what the bill lacks, in a stable order", () => {
    const { missingInfo } = mod();
    expect(missingInfo({
      billTo: { name: "", email: "", address: "" },
      serviceAddress: "",
      lineItems: [],
      amountCents: 0,
    })).toEqual([
      "noBillingName",
      "noBillingEmail",
      "noServiceAddress",
      "noLineItems",
      "noAmount",
    ]);
  });

  it("REQ-206 is empty for a complete bill", () => {
    const { missingInfo } = mod();
    expect(missingInfo({
      billTo: { name: "Ann", email: "ann@x.com", address: "1 Main" },
      serviceAddress: "1 Main",
      lineItems: [{ description: "x", quantity: 1, price: 100 }],
      amountCents: 100,
    })).toEqual([]);
  });
});

describe("REQ-206 bill-to from the customer", () => {
  it("REQ-206 billToFromCustomer copies name, business, email, phone, address", () => {
    const { billToFromCustomer } = mod();
    expect(billToFromCustomer({
      id: "c1",
      name: "Ann Lee",
      businessName: "Lee Props",
      email: "ann@x.com",
      phoneNumber: "+15125550100",
      address: "1 Main St",
    })).toEqual({
      name: "Ann Lee",
      businessName: "Lee Props",
      email: "ann@x.com",
      phoneNumber: "+15125550100",
      address: "1 Main St",
    });
    expect(billToFromCustomer(undefined)).toEqual({
      name: "",
      businessName: "",
      email: "",
      phoneNumber: "",
      address: "",
    });
  });
});

describe("REQ-206 POST body", () => {
  it("REQ-206 buildInvoiceBody carries every field in cents / basis points and the requestId", () => {
    const { buildInvoiceBody } = mod();
    const body = buildInvoiceBody({
      customerId: "c1",
      quoteId: "q1",
      jobName: "Fence",
      description: "Two gates",
      lineItems: [{
        description: "Gate",
        quantity: 2,
        unit: "ea",
        price: 25000,
      }],
      discountCents: 0,
      discountReason: "",
      taxRateBp: 825,
      netDays: 15,
      issuedDate: "2026-11-06",
      serviceAddress: "9 Oak",
      serviceDateFrom: "2026-11-01",
      serviceDateTo: "2026-11-02",
      paymentInstructions: "Zelle 512-555",
      billTo: {
        name: "Ann",
        businessName: "",
        email: "a@x",
        phoneNumber: "",
        address: "1 Main",
      },
    }, { requestId: "r-1", status: "sent" });
    expect(body).toEqual({
      requestId: "r-1",
      status: "sent",
      customerId: "c1",
      quoteId: "q1",
      jobName: "Fence",
      description: "Two gates",
      lineItems: [{
        description: "Gate",
        quantity: 2,
        unit: "ea",
        price: 25000,
      }],
      subtotalCents: 50000,
      taxRateBp: 825,
      taxCents: 4125,
      amount: 54125,
      netDays: 15,
      issuedDate: "2026-11-06",
      dueDate: "2026-11-21",
      serviceAddress: "9 Oak",
      serviceDateFrom: "2026-11-01",
      serviceDateTo: "2026-11-02",
      paymentInstructions: "Zelle 512-555",
      billTo: { name: "Ann", email: "a@x", address: "1 Main" },
    });
  });

  it("REQ-206 buildInvoiceBody drops empty strings and a zero discount, keeps a real one with its reason", () => {
    const { buildInvoiceBody } = mod();
    const body = buildInvoiceBody({
      lineItems: [],
      amountCents: 80000,
      discountCents: 5000,
      discountReason: "Repeat customer",
      taxRateBp: 0,
      netDays: 0,
      issuedDate: "2026-11-06",
      jobName: "",
      description: "",
      serviceAddress: "",
      paymentInstructions: "",
      billTo: {
        name: "",
        businessName: "",
        email: "",
        phoneNumber: "",
        address: "",
      },
    }, { requestId: "r-2", status: "draft" });
    expect(body.discountCents).toBe(5000);
    expect(body.discountReason).toBe("Repeat customer");
    expect(body.amount).toBe(75000);
    expect(body.dueDate).toBe("2026-11-06");
    expect(body).not.toHaveProperty("jobName");
    expect(body).not.toHaveProperty("customerId");
    expect(body).not.toHaveProperty("quoteId");
    expect(body).not.toHaveProperty("billTo");
    expect(body).not.toHaveProperty("serviceAddress");
    expect(body).not.toHaveProperty("taxRateBp");
  });
});

describe("REQ-205/206 prefill from the quote's ledger", () => {
  const ledger = {
    quote: {
      id: "q1",
      number: "Q-001",
      version: 1,
      status: "accepted",
      accepted: true,
      url: "/q/q1",
    },
    quoteTotalCents: 100000,
    approvedChangeOrdersCents: 0,
    agreementTotalCents: 100000,
    invoicedCents: 40000,
    paidCents: 0,
    invoicedUnpaidCents: 40000,
    remainingToInvoiceCents: 60000,
    overpaidCents: 0,
    invoices: [],
    changeOrders: [],
    workOrders: [],
  };

  it("REQ-206 prefillFromLedger takes the customer and job from the quote and the remaining amount from the ledger", () => {
    const { prefillFromLedger } = mod();
    expect(
      prefillFromLedger(ledger, {
        customerId: "c1",
        jobName: "Roof",
        summary: "Roof replacement",
      }),
    )
      .toEqual({
        quoteId: "q1",
        quoteNumber: "Q-001",
        customerId: "c1",
        jobName: "Roof",
        amountCents: 60000,
        agreedCents: 100000,
        invoicedCents: 40000,
        remainingCents: 60000,
      });
  });

  it("REQ-206 prefillFromLedger falls back to the summary and never prefills a negative amount", () => {
    const { prefillFromLedger } = mod();
    const p = prefillFromLedger({ ...ledger, remainingToInvoiceCents: -5 }, {
      summary: "Roof replacement",
    });
    expect(p.jobName).toBe("Roof replacement");
    expect(p.customerId).toBeUndefined();
    expect(p.amountCents).toBe(0);
  });
});

describe("REQ-201 headline: number · version · state", () => {
  it("REQ-201 a first-version sent invoice reads 'INV-001 · Version 1 · Sent'", () => {
    const { invoiceHeadline, formatInvoiceHeadline } = mod();
    const inv = { id: "abc", number: "INV-001", status: "sent" };
    expect(invoiceHeadline(inv)).toEqual({
      number: "INV-001",
      version: 1,
      state: "sent",
      revised: false,
    });
    expect(formatInvoiceHeadline(inv, LABELS, "Version")).toBe(
      "INV-001 · Version 1 · Sent",
    );
  });

  it("REQ-201 a revised unpaid invoice says it replaces the previous version", () => {
    const { invoiceHeadline, formatInvoiceHeadline } = mod();
    const inv = { id: "abc", number: "INV-5000", status: "sent", version: 2 };
    expect(invoiceHeadline(inv).revised).toBe(true);
    expect(formatInvoiceHeadline(inv, LABELS, "Version")).toBe(
      "INV-5000 · Version 2 · Revised invoice — replaces previous version",
    );
    // a claimed revision is still a revision
    expect(invoiceHeadline({ ...inv, status: "claimed" }).revised).toBe(true);
  });

  it("REQ-201 a paid invoice is paid, whatever its version; a legacy row keeps its #id reference", () => {
    const { invoiceHeadline, formatInvoiceHeadline } = mod();
    const paid = { id: "abc", number: "INV-002", status: "paid", version: 3 };
    expect(invoiceHeadline(paid)).toEqual({
      number: "INV-002",
      version: 3,
      state: "paid",
      revised: false,
    });
    expect(formatInvoiceHeadline(paid, LABELS, "Versión")).toBe(
      "INV-002 · Versión 3 · Paid",
    );
    expect(invoiceHeadline({ id: "0123456789", status: "draft" }).number).toBe(
      "#01234567",
    );
  });
});

describe("REQ-202 payment summary", () => {
  it("REQ-202 unpaid / partial / paid / overpaid, from amount and paidCents", () => {
    const { paymentSummary } = mod();
    expect(paymentSummary({ amount: 10000, paidCents: 0 }).kind).toBe("unpaid");
    const partial = paymentSummary({ amount: 10000, paidCents: 4000 });
    expect(partial).toEqual({
      kind: "partial",
      amountCents: 10000,
      paidCents: 4000,
      balanceCents: 6000,
      overpaidCents: 0,
    });
    expect(
      paymentSummary({ amount: 10000, paidCents: 10000, status: "paid" }).kind,
    ).toBe("paid");
    const over = paymentSummary({
      amount: 10000,
      paidCents: 10500,
      overpaidCents: 500,
      status: "paid",
    });
    expect(over.kind).toBe("overpaid");
    expect(over.overpaidCents).toBe(500);
    // a legacy paid row with no paidCents is paid, not partial
    expect(paymentSummary({ amount: 10000, status: "paid" }).kind).toBe("paid");
  });
});
