/**
 * REQ-201 / REQ-203 / REQ-205 / REQ-210 — the linked-documents view, pure:
 *   shared/documents/linked-view.ts
 *
 * The labels a document shows ("Q-001 · Version 3 · Accepted and signed ·
 * Nov 6, 2026"), the related-document rows a public page lists, the ledger
 * summary the quote panel shows, and what a public page does with a 409
 * (stale balance → show the current balance; stale version → reload).
 *
 * Lazy-required like format-helpers.test.ts so a missing module reds only
 * the tests that use it.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const lv = () => require("../../shared/documents/linked-view");

describe("REQ-201/205 docHeadline — number · version · state · date", () => {
  it("REQ-205 an accepted quote reads 'Q-001 · Version 3 · Accepted and signed · Nov 6, 2026'", () => {
    const { docHeadline } = lv();
    expect(
      docHeadline(
        {
          number: "Q-001",
          version: 3,
          state: "accepted",
          date: "2026-11-06T15:00:00Z",
        },
        "en",
      ),
    ).toBe("Q-001 · Version 3 · Accepted and signed · Nov 6, 2026");
  });

  it("REQ-205 the same headline in Spanish", () => {
    const { docHeadline } = lv();
    expect(
      docHeadline(
        {
          number: "Q-001",
          version: 3,
          state: "accepted",
          date: "2026-11-06T15:00:00Z",
        },
        "es",
      ),
    ).toBe("Q-001 · Versión 3 · Aceptada y firmada · 6 nov 2026");
  });

  it("REQ-201 a sent first version has no date part when none is given", () => {
    const { docHeadline } = lv();
    expect(docHeadline({ number: "Q-002", version: 1, state: "sent" }, "en"))
      .toBe("Q-002 · Version 1 · Sent");
  });

  it("REQ-201 a revised invoice says it replaces the previous version; a paid one says Paid", () => {
    const { invoiceHeadline } = lv();
    expect(
      invoiceHeadline(
        { number: "INV-5000", version: 2, state: "revised" },
        "en",
      ),
    )
      .toBe(
        "INV-5000 · Version 2 · Revised invoice — replaces previous version",
      );
    expect(
      invoiceHeadline({ number: "INV-5000", version: 1, state: "paid" }, "en"),
    )
      .toBe("INV-5000 · Version 1 · Paid");
  });

  it("REQ-201 a version-history line reads 'Version 1 · published Nov 3 by Rafa'", () => {
    const { versionHistoryLine } = lv();
    expect(
      versionHistoryLine(
        {
          version: 1,
          publishedAt: "2026-11-03T10:00:00Z",
          publishedBy: { name: "Rafa" },
        },
        "en",
      ),
    ).toBe("Version 1 · published Nov 3 by Rafa");
    expect(
      versionHistoryLine(
        {
          version: 2,
          publishedAt: "2026-11-05T10:00:00Z",
          publishedBy: { customer: true },
        },
        "en",
      ),
    ).toBe("Version 2 · published Nov 5 by the customer");
  });
});

describe("REQ-205 relatedDocumentRows — what a public page lists under the document", () => {
  const payload = {
    invoices: [
      {
        id: "i1",
        number: "INV-001",
        url: "/i/i1",
        status: "sent",
        state: "sent",
        amountCents: 40000,
        paidCents: 0,
        balanceCents: 40000,
      },
      {
        id: "i2",
        number: "INV-002",
        url: "/i/i2",
        status: "paid",
        state: "paid",
        amountCents: 60000,
        paidCents: 60000,
        balanceCents: 0,
      },
    ],
    changeOrders: [
      {
        id: "c1",
        number: "CO-001",
        url: "/co/c1",
        status: "approved",
        deltaAmountCents: 5000,
      },
      {
        id: "c2",
        number: "CO-002",
        url: "/co/c2",
        status: "pending",
        deltaAmountCents: 1000,
      },
      {
        id: "c3",
        number: "CO-003",
        url: "/co/c3",
        status: "declined",
        deltaAmountCents: 1000,
      },
    ],
  };

  it("REQ-205 every invoice is a row with its number, link, amount and balance", () => {
    const { relatedDocumentRows } = lv();
    const rows = relatedDocumentRows(payload, "en");
    const inv = rows.filter((r: { kind: string }) => r.kind === "invoice");
    expect(inv.map((r: { number: string }) => r.number)).toEqual([
      "INV-001",
      "INV-002",
    ]);
    expect(inv[0]).toMatchObject({
      id: "i1",
      url: "/i/i1",
      amountCents: 40000,
      balanceCents: 40000,
      stateLabel: "Sent",
    });
    expect(inv[1]).toMatchObject({
      url: "/i/i2",
      balanceCents: 0,
      stateLabel: "Paid",
    });
  });

  // REQ-457 (demo M27) amends this: a PENDING change order is listed too,
  // "Waiting for your approval"; a declined one is still left off.
  it("REQ-205 / REQ-457 approved and pending change orders are listed (declined are not), with their delta", () => {
    const { relatedDocumentRows } = lv();
    const rows = relatedDocumentRows(payload, "en");
    const cos = rows.filter((r: { kind: string }) => r.kind === "changeOrder");
    expect(cos.map((r: { number: string }) => r.number)).toEqual([
      "CO-001",
      "CO-002",
    ]);
    expect(cos[0]).toMatchObject({
      url: "/co/c1",
      deltaAmountCents: 5000,
      stateLabel: "Approved",
    });
    expect(cos[1]).toMatchObject({
      url: "/co/c2",
      deltaAmountCents: 1000,
      stateLabel: "Waiting for your approval",
      pending: true,
    });
  });

  it("REQ-205 a payload without lists yields no rows", () => {
    const { relatedDocumentRows } = lv();
    expect(relatedDocumentRows({}, "en")).toEqual([]);
  });
});

describe("REQ-205 ledgerSummary — the quote panel's totals", () => {
  const ledger = {
    quote: {
      id: "q",
      number: "Q-001",
      version: 1,
      accepted: true,
      url: "/q/q",
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

  it("REQ-205 agreed / invoiced / paid / invoiced-but-unpaid / remaining, in that order", () => {
    const { ledgerSummary } = lv();
    const s = ledgerSummary(ledger);
    expect(s.rows.map((r: { key: string; cents: number }) => [r.key, r.cents]))
      .toEqual([
        ["agreed", 100000],
        ["invoiced", 40000],
        ["paid", 0],
        ["invoicedUnpaid", 40000],
        ["remaining", 60000],
      ]);
    expect(s.overpaid).toBe(false);
    expect(s.canCreateNextInvoice).toBe(true);
  });

  it("REQ-205 nothing left to invoice disables the next invoice; an overpayment is flagged", () => {
    const { ledgerSummary } = lv();
    const s = ledgerSummary({
      ...ledger,
      invoicedCents: 100000,
      paidCents: 101000,
      invoicedUnpaidCents: 0,
      remainingToInvoiceCents: 0,
      overpaidCents: 1000,
    });
    expect(s.canCreateNextInvoice).toBe(false);
    expect(s.overpaid).toBe(true);
    expect(s.overpaidCents).toBe(1000);
  });
});

describe("REQ-249 ledgerSummary — an unsigned quote is 'Quoted', never 'Agreed' (demo quote-invoice-money-m10)", () => {
  const base = {
    quoteTotalCents: 1570000,
    approvedChangeOrdersCents: 0,
    agreementTotalCents: 1570000,
    invoicedCents: 0,
    paidCents: 0,
    invoicedUnpaidCents: 0,
    remainingToInvoiceCents: 1570000,
    overpaidCents: 0,
    invoices: [],
    changeOrders: [],
    workOrders: [],
  };
  const quote = (accepted: boolean) => ({
    id: "q",
    number: "Q-005",
    version: 1,
    accepted,
    url: "/q/q",
  });
  const keys = (s: { rows: { key: string; cents: number }[] }) =>
    s.rows.map((r) => [r.key, r.cents]);

  it("REQ-249 a quote that is not signed shows its total as 'quoted', and no row is 'agreed'", () => {
    const { ledgerSummary } = lv();
    const s = ledgerSummary({ ...base, quote: quote(false) });
    expect(keys(s)[0]).toEqual(["quoted", 1570000]);
    expect(s.rows.some((r: { key: string }) => r.key === "agreed")).toBe(false);
  });

  it("REQ-249 once the quote is signed the same row reads 'agreed'", () => {
    const { ledgerSummary } = lv();
    const s = ledgerSummary({ ...base, quote: quote(true) });
    expect(keys(s)[0]).toEqual(["agreed", 1570000]);
    expect(s.rows.some((r: { key: string }) => r.key === "quoted")).toBe(false);
  });

  it("REQ-249 both languages label the row: 'Quoted' / 'Cotizado'", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const en = require("../../lang/en.json");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const es = require("../../lang/es.json");
    expect(en["quotes.ledger.quoted"]).toBe("Quoted");
    expect(es["quotes.ledger.quoted"]).toBe("Cotizado");
    expect(en["quotes.ledger.agreed"]).toBe("Agreed");
    expect(es["quotes.ledger.agreed"]).toBe("Acordado");
  });
});

describe("REQ-203 public-page 409 decisions — stale balance, stale version", () => {
  it("REQ-203 a 409 stale_balance means: show the balance the server returned", () => {
    const { claimDecision } = lv();
    expect(
      claimDecision(409, {
        ok: false,
        reason: "stale_balance",
        balanceCents: 35000,
        version: 2,
      }),
    )
      .toEqual({ kind: "stale_balance", balanceCents: 35000, version: 2 });
  });

  it("REQ-203 a 409 already_paid means: render the paid state", () => {
    const { claimDecision } = lv();
    expect(claimDecision(409, { ok: false, reason: "already_paid" })).toEqual({
      kind: "already_paid",
    });
  });

  it("REQ-203 a 2xx is ok; any other failure is an error with its reason", () => {
    const { claimDecision } = lv();
    expect(claimDecision(200, { ok: true })).toEqual({ kind: "ok" });
    expect(claimDecision(400, { ok: false, reason: "invalid_method" })).toEqual(
      { kind: "error", reason: "invalid_method" },
    );
    expect(claimDecision(500, "boom")).toEqual({
      kind: "error",
      reason: "500",
    });
  });

  it("REQ-203 a 409 stale_version on accept means: reload the latest version", () => {
    const { acceptDecision } = lv();
    expect(
      acceptDecision(409, {
        ok: false,
        reason: "stale_version",
        currentVersion: 3,
      }),
    )
      .toEqual({ kind: "stale_version", currentVersion: 3 });
    expect(acceptDecision(409, { ok: false, reason: "already_accepted" }))
      .toEqual({ kind: "already_accepted" });
    expect(acceptDecision(200, { ok: true })).toEqual({ kind: "ok" });
  });

  it("REQ-203 the claim body carries the balance shown and the version shown", () => {
    const { claimBody } = lv();
    expect(
      claimBody({ method: "zelle", reference: " 123 ", claimedBy: "" }, {
        balanceCents: 40000,
        version: 2,
      }),
    )
      .toEqual({
        method: "zelle",
        reference: "123",
        amountCents: 40000,
        version: 2,
      });
  });
});

describe("REQ-210 work orders — the status walk", () => {
  it("REQ-210 open → in progress → done; cancel from any open state; a cancelled one reopens", () => {
    const { workOrderNextStatuses } = lv();
    expect(workOrderNextStatuses("open")).toEqual(["in_progress", "cancelled"]);
    expect(workOrderNextStatuses("in_progress")).toEqual(["done", "cancelled"]);
    expect(workOrderNextStatuses("done")).toEqual([]);
    expect(workOrderNextStatuses("cancelled")).toEqual(["open"]);
  });
});
