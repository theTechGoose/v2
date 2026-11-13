/**
 * REQ-207 (global search) / REQ-208 (CSV exports) — the pure rules.
 *
 *   shared/documents/search.ts   — numberRank, matchesDate, searchRecords, groupHits, urlFor
 *   shared/documents/exports.ts  — csv helpers, invoice / customer rows, status filter
 *
 * Lazy-required so a missing module reds only the tests that use it.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const search = () => require("../../shared/documents/search");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const exportsMod = () => require("../../shared/documents/exports");

const customers = [
  {
    id: "c1",
    number: "C-001",
    name: "Zelda Ortiz",
    address: "742 Evergreen Terrace",
    email: "z@x.com",
    phoneNumber: "(512) 555-0199",
    createdAt: "2026-11-06T10:00:00.000Z",
  },
  {
    id: "c2",
    number: "C-002",
    name: "Ann Lee",
    businessName: "Lee Roofing LLC",
    createdAt: "2026-10-01T10:00:00.000Z",
  },
];
const quotes = [
  {
    id: "q1",
    number: "Q-001",
    seq: 1,
    customerId: "c1",
    summary: "Roof repair",
    jobName: "Roof",
    status: "sent",
    estimatedTotal: 150000,
    createdAt: "2026-11-02T10:00:00.000Z",
  },
  {
    id: "q2",
    number: "Q-002",
    seq: 2,
    customerId: "c2",
    summary: "Deck",
    status: "draft",
    estimatedTotal: 5000,
    createdAt: "2026-09-02T10:00:00.000Z",
  },
];
const invoices = [
  {
    id: "i1",
    number: "INV-001",
    seq: 1,
    customerId: "c1",
    quoteId: "q1",
    jobName: "Roof",
    status: "sent",
    amount: 100000,
    paidCents: 0,
    issuedDate: "2026-11-06",
    dueDate: "2026-12-06",
    createdAt: "2026-11-06T10:00:00.000Z",
    serviceAddress: "9 Oak Ave",
    serviceDateFrom: "2026-11-20",
  },
  {
    id: "i2",
    number: "INV-002",
    seq: 2,
    customerId: "c1",
    quoteId: "q1",
    status: "paid",
    amount: 50000,
    paidCents: 50000,
    paidAt: "2026-11-07T10:00:00.000Z",
    issuedDate: "2026-11-07",
    dueDate: "2026-12-07",
    createdAt: "2026-11-07T10:00:00.000Z",
  },
  {
    id: "i3",
    number: "INV-020",
    seq: 20,
    customerId: "c2",
    status: "draft",
    amount: 700,
    issuedDate: "2026-03-05",
    dueDate: "2026-04-05",
    createdAt: "2026-03-05T10:00:00.000Z",
  },
  {
    id: "i4",
    number: "INV-5000",
    seq: 5000,
    customerId: "c2",
    status: "sent",
    amount: 800,
    issuedDate: "2026-05-01",
    dueDate: "2026-06-01",
    createdAt: "2026-05-01T10:00:00.000Z",
  },
];
const changeOrders = [
  {
    id: "co1",
    number: "CO-001",
    seq: 1,
    invoiceId: "i1",
    quoteId: "q1",
    customerId: "c1",
    description: "Add gutters",
    deltaAmountCents: 25000,
    status: "approved",
    createdAt: "2026-11-08T10:00:00.000Z",
  },
];
const workOrders = [
  {
    id: "wo1",
    number: "WO-001",
    seq: 1,
    invoiceId: "i1",
    quoteId: "q1",
    customerId: "c1",
    description: "Tear-off crew",
    status: "open",
    scheduledFor: "2026-11-21",
    createdAt: "2026-11-09T10:00:00.000Z",
  },
];
const data = { customers, quotes, invoices, changeOrders, workOrders };

describe("REQ-207 numberRank — exact, then prefix, then substring", () => {
  it("REQ-207 exact: 'INV-5', '5000', 'inv5000' name INV-5000 exactly; 'Q-1' names Q-001", () => {
    const { numberRank } = search();
    expect(numberRank("INV-5000", "INV-5000")).toBe(0);
    expect(numberRank("INV-5000", "5000")).toBe(0);
    expect(numberRank("INV-5000", "inv5000")).toBe(0);
    expect(numberRank("Q-001", "Q-1")).toBe(0);
    expect(numberRank("INV-005", "5")).toBe(0);
  });
  it("REQ-207 prefix: 'INV-5' is a prefix of INV-5000 (rank 1); 'INV-2' of INV-020 and INV-200", () => {
    const { numberRank } = search();
    expect(numberRank("INV-5000", "INV-5")).toBe(1);
    expect(numberRank("INV-020", "INV-2")).toBe(1);
    expect(numberRank("INV-200", "inv2")).toBe(1);
  });
  it("REQ-207 substring: '102' hits INV-5102 at rank 2; a wrong prefix never hits; '600' misses INV-5000", () => {
    const { numberRank } = search();
    expect(numberRank("INV-5102", "102")).toBe(2);
    expect(numberRank("INV-001", "Q-1")).toBeNull();
    expect(numberRank("C-001", "CO-1")).toBeNull();
    expect(numberRank("CO-001", "C-001")).not.toBe(0);
    expect(numberRank("INV-5000", "600")).toBeNull();
    expect(numberRank(undefined, "1")).toBeNull();
    expect(numberRank("INV-001", "")).toBeNull();
  });
});

describe("REQ-207 matchesDate — ISO substrings and 'Nov 6' style", () => {
  it("REQ-207 an ISO date or a yyyy-mm prefix hits the date", () => {
    const { matchesDate } = search();
    expect(matchesDate("2026-11-06", "2026-11-06")).toBe(true);
    expect(matchesDate("2026-11-06T10:00:00.000Z", "2026-11")).toBe(true);
    expect(matchesDate("2026-11-06", "2026-12")).toBe(false);
    expect(matchesDate(undefined, "2026")).toBe(false);
  });
  it("REQ-207 'Nov 6', 'nov 06', 'november 6', '6 nov' and the Spanish '6 nov' / 'noviembre' hit 2026-11-06", () => {
    const { matchesDate } = search();
    expect(matchesDate("2026-11-06", "Nov 6")).toBe(true);
    expect(matchesDate("2026-11-06", "nov 06")).toBe(true);
    expect(matchesDate("2026-11-06", "november 6")).toBe(true);
    expect(matchesDate("2026-11-06", "6 nov")).toBe(true);
    expect(matchesDate("2026-11-06", "noviembre")).toBe(true);
    expect(matchesDate("2026-11-06", "Nov 7")).toBe(false);
    expect(matchesDate("2026-11-06", "Dec 6")).toBe(false);
    expect(matchesDate("2026-11-06", "roof")).toBe(false);
  });
});

describe("REQ-207 searchRecords — what matches, how it ranks, what a row carries", () => {
  it("REQ-207 'inv-1' → the invoice row INV-001 first, with the customer, amount, status and its related Q-001 / CO-001 / WO-001", () => {
    const { searchRecords } = search();
    const hits = searchRecords(data, "inv-1");
    expect(hits[0].type).toBe("invoice");
    expect(hits[0].number).toBe("INV-001");
    expect(hits[0].rank).toBe(0);
    expect(hits[0].customerName).toBe("Zelda Ortiz");
    expect(hits[0].customerNumber).toBe("C-001");
    expect(hits[0].amountCents).toBe(100000);
    expect(hits[0].status).toBe("sent");
    expect(hits[0].url).toBe("/invoices?open=i1");
    const related = hits[0].related.map((r: { number: string }) => r.number);
    expect(related).toEqual(["Q-001", "CO-001", "WO-001"]);
    expect(hits[0].related[0].url).toBe("/quotes?open=q1");
  });
  it("REQ-207 '742 ever' → the customer and the invoice billed to that address (customer address counts for the invoice)", () => {
    const { searchRecords } = search();
    const hits = searchRecords(data, "742 ever");
    const types = hits.map((h: { type: string; number: string }) =>
      `${h.type}:${h.number}`
    );
    expect(types).toContain("customer:C-001");
    expect(types).toContain("invoice:INV-001");
    expect(types).toContain("invoice:INV-002");
    expect(types).not.toContain("invoice:INV-020");
  });
  it("REQ-207 'C-001' → the customer row first with its counts; 'CO-1' → the change order, not the customer", () => {
    const { searchRecords } = search();
    const hits = searchRecords(data, "C-001");
    expect(hits[0].type).toBe("customer");
    expect(hits[0].number).toBe("C-001");
    expect(hits[0].counts).toEqual({
      quotes: 1,
      invoices: 2,
      changeOrders: 1,
      workOrders: 1,
    });
    expect(hits[0].url).toBe("/customers?open=c1"); // REQ-799
    const co = searchRecords(data, "CO-1");
    expect(co[0].type).toBe("changeOrder");
    expect(co.find((h: { type: string }) => h.type === "customer"))
      .toBeUndefined();
  });
  it("REQ-207 a quote row shows its invoice numbers; 'Q-001' ranks the quote first and its invoices after", () => {
    const { searchRecords } = search();
    const hits = searchRecords(data, "Q-001");
    expect(hits[0].type).toBe("quote");
    expect(hits[0].number).toBe("Q-001");
    expect(hits[0].related.map((r: { number: string }) => r.number)).toEqual([
      "INV-001",
      "INV-002",
      "CO-001",
      "WO-001",
    ]);
    expect(
      hits.some((h: { type: string; number: string }) =>
        h.type === "invoice" && h.number === "INV-001"
      ),
    ).toBe(true);
    expect(hits[0].rank).toBe(0);
  });
  it("REQ-207 'INV-2' → INV-002 exact before the INV-020 prefix; '5' → INV-5000 after nothing exact", () => {
    const { searchRecords } = search();
    const nums = searchRecords(data, "INV-2").filter((h: { type: string }) =>
      h.type === "invoice"
    ).map((h: { number: string }) => h.number);
    expect(nums).toEqual(["INV-002", "INV-020"]);
    const five = searchRecords(data, "5").filter((h: { type: string }) =>
      h.type === "invoice"
    ).map((h: { number: string }) => h.number);
    expect(five[0]).toBe("INV-5000");
  });
  it("REQ-207 dates: 'Nov 6' hits INV-001 (issued), '2026-11-20' hits INV-001 (service from) and WO-001 (scheduled)", () => {
    const { searchRecords } = search();
    const nov6 = searchRecords(data, "Nov 6").map((h: { number: string }) =>
      h.number
    );
    expect(nov6).toContain("INV-001");
    expect(nov6).not.toContain("INV-020");
    const nov20 = searchRecords(data, "2026-11-2").map((
      h: { number: string },
    ) => h.number);
    expect(nov20).toContain("INV-001");
    expect(nov20).toContain("WO-001");
  });
  it("REQ-207 names, business, phone digits, service address, assignee and descriptions all match; empty query → []", () => {
    const { searchRecords } = search();
    expect(searchRecords(data, "").length).toBe(0);
    expect(searchRecords(data, "   ").length).toBe(0);
    expect(searchRecords(data, "lee roofing")[0].number).toBe("C-002");
    expect(searchRecords(data, "5550199")[0].number).toBe("C-001");
    expect(
      searchRecords(data, "9 oak").map((h: { number: string }) => h.number),
    ).toEqual(["INV-001"]);
    expect(searchRecords(data, "tear-off")[0].number).toBe("WO-001");
    expect(searchRecords(data, "gutters")[0].number).toBe("CO-001");
    expect(searchRecords(data, "ann lee").map((h: { type: string }) => h.type))
      .toEqual(["customer", "quote", "invoice", "invoice"]);
  });
  it("REQ-207 limit caps each type; types narrows", () => {
    const { searchRecords } = search();
    const many = {
      ...data,
      invoices: Array.from(
        { length: 30 },
        (_, i) => ({
          id: `x${i}`,
          number: `INV-${String(100 + i)}`,
          seq: 100 + i,
          status: "sent",
          amount: 1,
          dueDate: "2026-01-01",
          createdAt: "2026-01-01",
        }),
      ),
    };
    expect(
      searchRecords(many, "inv", { limit: 5 }).filter((h: { type: string }) =>
        h.type === "invoice"
      ).length,
    ).toBe(5);
    expect(
      searchRecords(data, "roof", { types: ["quote"] }).every((
        h: { type: string },
      ) => h.type === "quote"),
    ).toBe(true);
  });
  it("REQ-207 groupHits keeps the type order customers → quotes → invoices → change orders → work orders; urlFor maps every type", () => {
    const { groupHits, searchRecords, urlFor } = search();
    const groups = groupHits(searchRecords(data, "zelda"));
    expect(groups.map((g: { type: string }) => g.type)).toEqual([
      "customer",
      "quote",
      "invoice",
      "changeOrder",
      "workOrder",
    ]);
    // REQ-799: a customer opens its sheet, not the roster
    expect(urlFor("customer", "c1")).toBe("/customers?open=c1");
    expect(urlFor("quote", "q1")).toBe("/quotes?open=q1");
    expect(urlFor("invoice", "i1")).toBe("/invoices?open=i1");
    expect(urlFor("changeOrder", "co1")).toBe("/co/co1");
    expect(urlFor("workOrder", "wo1")).toBe("/wo/wo1");
  });
});

describe("REQ-208 csv helpers — RFC 4180, BOM, dollars, ISO dates", () => {
  it("REQ-208 csvCell quotes commas, quotes and newlines and doubles interior quotes", () => {
    const { csvCell } = exportsMod();
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(12)).toBe("12");
  });
  it("REQ-208 toCsv starts with the UTF-8 BOM, joins rows with CRLF and has no trailing newline", () => {
    const { toCsv } = exportsMod();
    const out = toCsv([["A", "B"], ["1", "x,y"]]);
    expect(out.charCodeAt(0)).toBe(0xfeff);
    expect(out.slice(1)).toBe('A,B\r\n1,"x,y"');
    expect(out.split("\r\n").length).toBe(2);
  });
  it("REQ-208 dollars renders cents with two decimals; isoDate keeps yyyy-mm-dd and drops the time", () => {
    const { dollars, isoDate } = exportsMod();
    expect(dollars(123456)).toBe("1234.56");
    expect(dollars(5)).toBe("0.05");
    expect(dollars(0)).toBe("0.00");
    expect(dollars(undefined)).toBe("");
    expect(isoDate("2026-11-06T10:00:00.000Z")).toBe("2026-11-06");
    expect(isoDate("2026-11-06")).toBe("2026-11-06");
    expect(isoDate("")).toBe("");
    expect(isoDate(undefined)).toBe("");
  });
});

describe("REQ-208 invoice export — the columns and one row", () => {
  it("REQ-208 the header is exactly the agreed column list", () => {
    const { INVOICE_EXPORT_HEADER } = exportsMod();
    expect(INVOICE_EXPORT_HEADER).toEqual([
      "Invoice #",
      "Version",
      "Status",
      "Customer #",
      "Customer",
      "Business",
      "Email",
      "Phone",
      "Billing address",
      "Service address",
      "Service from",
      "Service to",
      "Quote #",
      "Change orders",
      "Issued",
      "Due",
      "Paid on",
      "Subtotal",
      "Discount",
      "Tax",
      "Total",
      "Paid",
      "Balance",
      "Overpaid",
      "Link",
    ]);
  });
  it("REQ-208 a row: billTo wins over the snapshot, amounts in dollars, dates ISO, change orders joined, balance from paid", () => {
    const { invoiceExportRow, INVOICE_EXPORT_HEADER } = exportsMod();
    const inv = {
      id: "i1",
      number: "INV-001",
      version: 2,
      status: "sent",
      customerId: "c1",
      quoteId: "q1",
      amount: 110000,
      subtotalCents: 100000,
      discountCents: 5000,
      taxCents: 15000,
      paidCents: 40000,
      issuedDate: "2026-11-06",
      dueDate: "2026-12-06T00:00:00.000Z",
      serviceAddress: "9 Oak Ave",
      serviceDateFrom: "2026-11-20",
      serviceDateTo: "2026-11-22",
      createdAt: "2026-11-06T10:00:00.000Z",
      billTo: {
        name: "Zelda Ortiz",
        businessName: "Ortiz & Co",
        email: "z@x.com",
        phoneNumber: "512",
        address: "742 Evergreen Terrace",
      },
      customerSnapshot: { name: "Old Name", number: "C-001" },
    };
    const row = invoiceExportRow(inv, {
      customer: customers[0],
      quote: quotes[0],
      changeOrders: [changeOrders[0], { id: "co2", number: "CO-002" }],
      link: "https://documonster.com/i/i1",
    });
    expect(row.length).toBe(INVOICE_EXPORT_HEADER.length);
    expect(row).toEqual([
      "INV-001",
      "2",
      "sent",
      "C-001",
      "Zelda Ortiz",
      "Ortiz & Co",
      "z@x.com",
      "512",
      "742 Evergreen Terrace",
      "9 Oak Ave",
      "2026-11-20",
      "2026-11-22",
      "Q-001",
      "CO-001 CO-002",
      "2026-11-06",
      "2026-12-06",
      "",
      "1000.00",
      "50.00",
      "150.00",
      "1100.00",
      "400.00",
      "700.00",
      "0.00",
      "https://documonster.com/i/i1",
    ]);
  });
  it("REQ-208 a paid invoice without paidCents counts its amount as paid; an overpaid one shows the excess; an unnumbered row shows its # reference", () => {
    const { invoiceExportRow } = exportsMod();
    const paid = invoiceExportRow({
      id: "abcdef1234",
      status: "paid",
      amount: 1000,
      paidAt: "2026-11-07T10:00:00.000Z",
      dueDate: "2026-12-01",
      createdAt: "2026-11-01",
    }, { changeOrders: [], link: "" });
    expect(paid[0]).toBe("#ABCDEF12");
    expect(paid[16]).toBe("2026-11-07");
    expect(paid.slice(20, 24)).toEqual(["10.00", "10.00", "0.00", "0.00"]);
    const over = invoiceExportRow({
      id: "i9",
      number: "INV-009",
      status: "paid",
      amount: 1000,
      paidCents: 1500,
      dueDate: "2026-12-01",
      createdAt: "2026-11-01",
    }, { changeOrders: [], link: "" });
    expect(over.slice(20, 24)).toEqual(["10.00", "15.00", "0.00", "5.00"]);
  });
  it("REQ-208 filterInvoicesForExport: all / paid / unpaid (issued and open); parseExportStatus rejects anything else", () => {
    const { filterInvoicesForExport, parseExportStatus } = exportsMod();
    const rows = [
      { id: "a", status: "paid" },
      { id: "b", status: "sent" },
      { id: "c", status: "draft" },
      { id: "d", status: "void" },
      { id: "e", status: "claimed" },
      { id: "f", status: "scheduled" },
      { id: "g", status: "viewed" },
    ];
    expect(
      filterInvoicesForExport(rows, "all").map((r: { id: string }) => r.id),
    ).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
    expect(
      filterInvoicesForExport(rows, "paid").map((r: { id: string }) => r.id),
    ).toEqual(["a"]);
    expect(
      filterInvoicesForExport(rows, "unpaid").map((r: { id: string }) => r.id),
    ).toEqual(["b", "e", "g"]);
    expect(parseExportStatus("all")).toBe("all");
    expect(parseExportStatus("PAID")).toBe("paid");
    expect(parseExportStatus("unpaid")).toBe("unpaid");
    expect(parseExportStatus("bogus")).toBeNull();
    expect(parseExportStatus(undefined)).toBeNull();
  });
  it("REQ-208 invoiceExportCsv: header + one line per invoice, BOM first", () => {
    const { invoiceExportCsv } = exportsMod();
    const csv = invoiceExportCsv(invoices, {
      customerOf: (inv: { customerId?: string }) =>
        customers.find((c) => c.id === inv.customerId),
      quoteOf: (inv: { quoteId?: string }) =>
        quotes.find((q) => q.id === inv.quoteId),
      changeOrdersOf: (inv: { id: string }) =>
        changeOrders.filter((co) => co.invoiceId === inv.id),
      linkOf: (inv: { id: string }) => `https://x/i/${inv.id}`,
    });
    const lines = csv.split("\r\n");
    expect(lines.length).toBe(5);
    expect(lines[0].startsWith("﻿Invoice #,")).toBe(true);
    expect(lines[1].startsWith("INV-001,1,sent,C-001,Zelda Ortiz,")).toBe(true);
    expect(lines[1]).toContain(",Q-001,CO-001,");
  });
});

describe("REQ-208 customer export — the columns and one row", () => {
  it("REQ-208 the header is exactly the agreed column list", () => {
    const { CUSTOMER_EXPORT_HEADER } = exportsMod();
    expect(CUSTOMER_EXPORT_HEADER).toEqual([
      "Customer #",
      "Name",
      "Business",
      "Email",
      "Phone",
      "Address",
      "Created",
      "Quotes",
      "Invoices",
      "Open balance",
    ]);
  });
  it("REQ-208 a row lists the customer's quote and invoice numbers and sums the open balance of its unpaid invoices", () => {
    const { customerExportRow } = exportsMod();
    const row = customerExportRow(customers[0], {
      quotes: quotes.filter((q) => q.customerId === "c1"),
      invoices: invoices.filter((i) => i.customerId === "c1"),
    });
    expect(row).toEqual([
      "C-001",
      "Zelda Ortiz",
      "",
      "z@x.com",
      "(512) 555-0199",
      "742 Evergreen Terrace",
      "2026-11-06",
      "Q-001",
      "INV-001 INV-002",
      "1000.00",
    ]);
  });
  it("REQ-208 customerExportCsv: header + one line per customer, a customer with nothing shows 0.00", () => {
    const { customerExportCsv } = exportsMod();
    const csv = customerExportCsv(
      [...customers, {
        id: "c3",
        number: "C-003",
        name: "Nobody",
        createdAt: "2026-01-01T00:00:00.000Z",
      }],
      quotes,
      invoices,
    );
    const lines = csv.split("\r\n");
    expect(lines.length).toBe(4);
    expect(lines[0].startsWith("﻿Customer #,")).toBe(true);
    expect(lines[2]).toBe(
      "C-002,Ann Lee,Lee Roofing LLC,,,,2026-10-01,Q-002,INV-020 INV-5000,8.00",
    );
    expect(lines[3]).toBe("C-003,Nobody,,,,,2026-01-01,,,0.00");
  });
});

describe("REQ-799 one search bar — the topbar's; a result opens the item itself", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("fs");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require("path");
  const ROOT = path.resolve(__dirname, "../..");
  const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

  it("REQ-799 a customer hit links to its sheet, URL-encoded; every hit of searchRecords carries an item url", () => {
    const { urlFor, searchRecords } = search();
    expect(urlFor("customer", "c1")).toBe("/customers?open=c1");
    expect(urlFor("customer", "a b")).toBe("/customers?open=a%20b");
    const hits = searchRecords(data, "zelda");
    const customer = hits.find((h: { type: string }) => h.type === "customer");
    expect(customer.url).toBe("/customers?open=c1");
    for (const h of hits) expect(h.url).not.toBe("/customers");
  });

  it("REQ-799 the Customers page has no search box of its own; the topbar's GlobalSearch opens hit.url", () => {
    const board = read("front-end/islands/ClientsBoard.tsx");
    expect(board).not.toMatch(/clients-search/);
    expect(board).not.toMatch(/clientsBoard\.searchPlaceholder/);
    expect(board).not.toMatch(/\bonQuery\b/);
    const page = read("front-end/islands/ClientsPage.tsx");
    expect(page).not.toMatch(/onQuery=\{/);
    const gs = read("front-end/islands/GlobalSearch.tsx");
    expect(gs).toMatch(/globalThis\.location\.assign\(hit\.url\)/);
    for (const lang of ["en", "es"]) {
      const dict = JSON.parse(read(`lang/${lang}.json`));
      expect(dict["clientsBoard.searchPlaceholder"]).toBeUndefined();
    }
  });
});
