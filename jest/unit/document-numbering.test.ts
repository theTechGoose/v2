/**
 * REQ-198/201/202/205 — the pure document modules under shared/documents:
 * numbering (formats, parsing, matching), versions (state, locks, edit
 * decisions, revisions, balances) and the quote ledger.
 *
 * The modules are resolved lazily from DOCS_MODULE_DIR (default
 * ../../shared/documents) so the red can be shown without moving files:
 *   DOCS_MODULE_DIR=/nonexistent npx jest unit/document-numbering.test.ts
 */
const DIR = process.env.DOCS_MODULE_DIR ?? "../../shared/documents";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const numbering = () => require(`${DIR}/numbering`);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const versions = () => require(`${DIR}/versions`);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ledger = () => require(`${DIR}/ledger`);

describe("REQ-198 document numbers", () => {
  test("REQ-198 formats every kind with its prefix and at least three digits, account numbers with four", () => {
    const { formatDocNumber, formatAccountNumber } = numbering();
    expect(formatDocNumber("invoice", 1)).toBe("INV-001");
    expect(formatDocNumber("invoice", 5000)).toBe("INV-5000");
    expect(formatDocNumber("quote", 12)).toBe("Q-012");
    expect(formatDocNumber("customer", 1)).toBe("C-001");
    expect(formatDocNumber("changeOrder", 7)).toBe("CO-007");
    expect(formatDocNumber("workOrder", 100)).toBe("WO-100");
    expect(formatAccountNumber(1)).toBe("DM-0001");
    expect(formatAccountNumber(12345)).toBe("DM-12345");
  });

  test("REQ-198 docNumberOf prefers the stored number and falls back to a short id, never undefined", () => {
    const { docNumberOf } = numbering();
    expect(docNumberOf({ id: "abc", number: "INV-001" })).toBe("INV-001");
    expect(docNumberOf({ id: "0123456789abcdef" })).toBe("#01234567");
  });

  test("REQ-199 starting numbers are parsed strictly: integers ≥ 1 within the cap", () => {
    const { parseStartingNumber, DEFAULT_START, MAX_START, startFor } =
      numbering();
    expect(parseStartingNumber("5000")).toBe(5000);
    expect(parseStartingNumber(1)).toBe(1);
    expect(parseStartingNumber(0)).toBeNull();
    expect(parseStartingNumber("abc")).toBeNull();
    expect(parseStartingNumber(1.5)).toBeNull();
    expect(parseStartingNumber(MAX_START + 1)).toBeNull();
    expect(DEFAULT_START).toBe(1);
    expect(startFor(null, "invoice")).toBe(1);
    expect(startFor({ invoiceStart: 5000 }, "invoice")).toBe(5000);
    expect(startFor({ invoiceStart: 5000 }, "quote")).toBe(1);
  });

  test("REQ-207 matchesDocNumber is prefix- and dash-insensitive and matches partial numbers", () => {
    const { matchesDocNumber } = numbering();
    expect(matchesDocNumber("INV-5000", "inv-5000")).toBe(true);
    expect(matchesDocNumber("INV-5000", "5000")).toBe(true);
    expect(matchesDocNumber("INV-5000", "inv5")).toBe(true);
    expect(matchesDocNumber("INV-5000", "INV-5")).toBe(true);
    expect(matchesDocNumber("INV-5000", "Q-5")).toBe(false);
    expect(matchesDocNumber("INV-5000", "i5")).toBe(true);
    expect(matchesDocNumber("INV-005", "5")).toBe(true);
    expect(matchesDocNumber("INV-5000", "")).toBe(false);
  });
});

describe("REQ-201/202 versions, locks and revisions", () => {
  test("REQ-201 versionOf defaults to 1; a revision advances it and files the version it replaces", () => {
    const { versionOf, applyRevision } = versions();
    const doc = {
      id: "q1",
      userId: "u",
      summary: "Roof",
      estimatedTotal: 1000,
      pendingRevision: { summary: "Roof + gutters" },
    };
    expect(versionOf(doc)).toBe(1);
    const { next, filed } = applyRevision(doc, { summary: "Roof + gutters" }, {
      userId: "u",
      name: "Rafa",
    }, "2026-11-06T00:00:00.000Z");
    expect(next.version).toBe(2);
    expect(next.summary).toBe("Roof + gutters");
    expect(next.pendingRevision).toBeUndefined();
    expect(next.publishedBy).toEqual({ userId: "u", name: "Rafa" });
    expect(filed.version).toBe(1);
    expect(filed.content.summary).toBe("Roof");
    expect(filed.supersededAt).toBe("2026-11-06T00:00:00.000Z");
  });

  test("REQ-201 editing an issued quote goes pending; a signed quote is locked; a draft applies live", () => {
    const { quoteEditDecision } = versions();
    expect(quoteEditDecision({ status: "draft" }, { summary: "x" }).mode).toBe(
      "apply",
    );
    const pending = quoteEditDecision({ status: "sent" }, {
      summary: "x",
      status: "sent",
    });
    expect(pending.mode).toBe("pending");
    expect(pending.fields).toEqual(["summary"]);
    const locked = quoteEditDecision({
      status: "accepted",
      acceptedAt: "2026-11-01",
    }, { summary: "x" });
    expect(locked.mode).toBe("locked");
    expect(locked.reason).toBe("locked_signed");
    // meta-only edits on an issued quote still apply live
    expect(quoteEditDecision({ status: "sent" }, { status: "sent" }).mode).toBe(
      "apply",
    );
  });

  test("REQ-202 an invoice is revisable until fully paid; a paid one is locked", () => {
    const { invoiceEditDecision, isInvoiceLocked } = versions();
    expect(invoiceEditDecision({ status: "sent" }, { amount: 5 }).mode).toBe(
      "pending",
    );
    expect(
      invoiceEditDecision({ status: "pending", paidCents: 50, amount: 100 }, {
        amount: 120,
      }).mode,
    ).toBe("pending");
    const locked = invoiceEditDecision({ status: "paid" }, { amount: 5 });
    expect(locked.mode).toBe("locked");
    expect(locked.reason).toBe("locked_paid");
    expect(isInvoiceLocked({ status: "paid" })).toBe(true);
    expect(isInvoiceLocked({ status: "sent" })).toBe(false);
  });

  test("REQ-202 balances keep partial payments and flag overpayment instead of hiding it", () => {
    const { invoiceBalance } = versions();
    expect(invoiceBalance(10000, 4000)).toEqual({
      amountCents: 10000,
      paidCents: 4000,
      balanceCents: 6000,
      overpaidCents: 0,
    });
    expect(invoiceBalance(8000, 10000)).toEqual({
      amountCents: 8000,
      paidCents: 10000,
      balanceCents: 0,
      overpaidCents: 2000,
    });
    expect(invoiceBalance(undefined, undefined)).toEqual({
      amountCents: 0,
      paidCents: 0,
      balanceCents: 0,
      overpaidCents: 0,
    });
  });

  test("REQ-201 document states", () => {
    const { quoteState, invoiceState } = versions();
    expect(quoteState({ status: "draft" })).toBe("draft");
    expect(quoteState({ status: "sent" })).toBe("sent");
    expect(quoteState({ status: "sent", version: 2 })).toBe("revised");
    expect(quoteState({ status: "accepted" })).toBe("accepted");
    expect(invoiceState({ status: "paid" })).toBe("paid");
    expect(invoiceState({ status: "sent", version: 3 })).toBe("revised");
    expect(invoiceState({ status: "void" })).toBe("void");
  });
});

describe("REQ-205 the quote ledger", () => {
  const quote = {
    id: "q1",
    number: "Q-001",
    version: 3,
    status: "accepted",
    estimatedTotal: 100000,
  };
  const invoices = [
    {
      id: "i2",
      number: "INV-002",
      seq: 2,
      status: "sent",
      amount: 30000,
      paidCents: 0,
      createdAt: "2026-11-02",
    },
    {
      id: "i1",
      number: "INV-001",
      seq: 1,
      status: "paid",
      amount: 40000,
      paidCents: 45000,
      createdAt: "2026-11-01",
    },
    {
      id: "i3",
      number: "INV-003",
      seq: 3,
      status: "void",
      amount: 99999,
      createdAt: "2026-11-03",
    },
  ];
  const cos = [
    {
      id: "c1",
      number: "CO-001",
      status: "approved",
      deltaAmountCents: 20000,
      invoiceId: "i2",
    },
    { id: "c2", number: "CO-002", status: "pending", deltaAmountCents: 50000 },
  ];

  test("REQ-205 agreed = quote + approved change orders; remaining-to-invoice and invoiced-but-unpaid are separate; void invoices are freed", () => {
    const { quoteLedger } = ledger();
    const l = quoteLedger(quote, invoices, cos);
    expect(l.quote).toEqual({
      id: "q1",
      number: "Q-001",
      version: 3,
      status: "accepted",
      accepted: true,
      url: "/q/q1",
    });
    expect(l.quoteTotalCents).toBe(100000);
    expect(l.approvedChangeOrdersCents).toBe(20000);
    expect(l.agreementTotalCents).toBe(120000);
    expect(l.invoicedCents).toBe(70000);
    expect(l.paidCents).toBe(45000);
    expect(l.invoicedUnpaidCents).toBe(30000);
    expect(l.remainingToInvoiceCents).toBe(50000);
    expect(l.overpaidCents).toBe(5000);
  });

  test("REQ-205 rows are in number order with clickable urls and the change order names its invoice", () => {
    const { quoteLedger } = ledger();
    const l = quoteLedger(quote, invoices, cos, [{
      id: "w1",
      number: "WO-001",
      status: "open",
      invoiceId: "i2",
    }]);
    expect(l.invoices.map((r: { number: string }) => r.number)).toEqual([
      "INV-001",
      "INV-002",
      "INV-003",
    ]);
    expect(l.invoices[0]).toMatchObject({
      url: "/i/i1",
      balanceCents: 0,
      overpaidCents: 5000,
      paidCents: 45000,
    });
    expect(l.invoices[2].balanceCents).toBe(0);
    expect(l.changeOrders[0]).toMatchObject({
      number: "CO-001",
      invoiceNumber: "INV-002",
      url: "/co/c1",
    });
    expect(l.workOrders[0]).toMatchObject({
      number: "WO-001",
      invoiceNumber: "INV-002",
      url: "/wo/w1",
      status: "open",
    });
  });

  test("REQ-205 a quote without an estimated total sums its line items", () => {
    const { quoteTotalCents, quoteLedger } = ledger();
    expect(
      quoteTotalCents({
        id: "q",
        lineItems: [{ price: 1000, quantity: 3 }, { price: 500 }],
      }),
    ).toBe(3500);
    expect(
      quoteLedger(
        { id: "q", lineItems: [{ price: 1000, quantity: 3 }] },
        [],
        [],
      ).remainingToInvoiceCents,
    ).toBe(3000);
  });
});
