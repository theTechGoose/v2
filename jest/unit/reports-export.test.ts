/**
 * REQ-794 — /invoices has two export buttons (all, unpaid); the year link is gone.
 * REQ-795 — Reports: pick a slice and a date range, download the CSV.
 * Raphael: "just put 2 buttons, all invoices, all unpaid invoices. ... make a data export
 * section at the top level ... select what slice of data we want and for what dates."
 * (then: "instead of data export call it reports.")
 */
import * as fs from "fs";
import * as path from "path";
import {
  exportDateOf,
  inDateRange,
  parseIsoDay,
  PAYMENT_EXPORT_HEADER,
  paymentExportCsv,
  QUOTE_EXPORT_HEADER,
  quoteExportCsv,
} from "../../shared/documents/exports";
import {
  isValidRange,
  presetRange,
  REPORT_SLICES,
  reportExportHref,
} from "../../front-end/lib/reports-export";
import { NAV } from "../../front-end/lib/nav-tree";
import { viewAt } from "../../front-end/lib/nav-folders";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-794 the /invoices hero offers exactly two export links", () => {
  const island = read("front-end/islands/InvoicesPage.tsx");
  const row = island.slice(
    island.indexOf('<div class="qph__cta-row">'),
    island.indexOf("</header>", island.indexOf('<div class="qph__cta-row">')),
  );
  test("all + unpaid stay, the year link is gone", () => {
    expect(row).toContain('data-cy="invoice-export-all"');
    expect(row).toContain('data-cy="invoice-export-unpaid"');
    expect(row).not.toContain('data-cy="invoice-export"\n');
    expect(row).not.toContain("invoicesPage.exportCsv");
    expect(row).not.toMatch(/export\.csv\?year=/);
    expect((row.match(/export\.csv/g) ?? []).length).toBe(2);
  });
});

describe("REQ-795 shared date-range helpers", () => {
  test("parseIsoDay accepts a YYYY-MM-DD day and refuses anything else", () => {
    expect(parseIsoDay("2026-03-05")).toBe("2026-03-05");
    expect(parseIsoDay(" 2026-03-05 ")).toBe("2026-03-05");
    expect(parseIsoDay("2026-13-05")).toBeNull();
    expect(parseIsoDay("2026-02-30")).toBeNull();
    expect(parseIsoDay("03/05/2026")).toBeNull();
    expect(parseIsoDay("")).toBeNull();
    expect(parseIsoDay(undefined)).toBeNull();
  });
  test("inDateRange is inclusive on both ends, each end optional, and a missing date never matches a bounded range", () => {
    expect(inDateRange("2026-03-05T10:00:00.000Z", "2026-03-05", "2026-03-05"))
      .toBe(true);
    expect(inDateRange("2026-03-04", "2026-03-05", undefined)).toBe(false);
    expect(inDateRange("2026-03-06", undefined, "2026-03-05")).toBe(false);
    expect(inDateRange("2026-03-06", undefined, undefined)).toBe(true);
    expect(inDateRange(undefined, undefined, undefined)).toBe(true);
    expect(inDateRange(undefined, "2026-01-01", undefined)).toBe(false);
  });
  test("exportDateOf: invoices by issued (else created), paid by paidAt, payments by receivedAt, quotes/customers by createdAt", () => {
    const inv = {
      issuedDate: "2026-02-01",
      createdAt: "2026-01-20T00:00:00Z",
      paidAt: "2026-03-01T00:00:00Z",
    };
    expect(exportDateOf("invoices", inv)).toBe("2026-02-01");
    expect(exportDateOf("invoices", { createdAt: "2026-01-20T00:00:00Z" }))
      .toBe("2026-01-20");
    expect(exportDateOf("paid", inv)).toBe("2026-03-01");
    expect(exportDateOf("paid", { status: "paid" })).toBe("");
    expect(exportDateOf("payments", { receivedAt: "2026-04-02T12:00:00Z" }))
      .toBe("2026-04-02");
    expect(exportDateOf("quotes", { createdAt: "2026-05-03T00:00:00Z" })).toBe(
      "2026-05-03",
    );
    expect(exportDateOf("customers", { createdAt: "2026-06-04T00:00:00Z" }))
      .toBe("2026-06-04");
  });
});

describe("REQ-795 quote and payment CSVs", () => {
  test("quoteExportCsv: the agreed columns, dollars, ISO days, the link", () => {
    const csv = quoteExportCsv(
      [{
        id: "q1",
        number: "Q-007",
        status: "accepted",
        customerId: "c1",
        jobName: "Roof, north side",
        estimatedTotal: 150050,
        createdAt: "2026-05-03T10:00:00.000Z",
        sentAt: "2026-05-04T10:00:00.000Z",
        acceptedAt: "2026-05-06T10:00:00.000Z",
      }],
      {
        customerOf: () => ({
          id: "c1",
          name: "Zelda Ortiz",
          number: "C-001",
          email: "z@x.com",
          phoneNumber: "+15125550199",
        }),
        linkOf: (q) => `https://documonster.com/q/${q.id}`,
      },
    );
    const lines = csv.replace(/^﻿/, "").split("\r\n");
    expect(lines[0]).toBe(QUOTE_EXPORT_HEADER.join(","));
    expect(lines[1]).toBe(
      'Q-007,accepted,C-001,Zelda Ortiz,z@x.com,+15125550199,"Roof, north side",1500.50,2026-05-03,2026-05-04,2026-05-06,https://documonster.com/q/q1',
    );
  });
  test("paymentExportCsv: date, invoice, customer, method, amount, reference", () => {
    const csv = paymentExportCsv(
      [{
        id: "p1",
        invoiceId: "i1",
        amount: 2500,
        method: "zelle",
        receivedAt: "2026-04-02T12:00:00Z",
        reference: "ZL-1",
      }],
      {
        invoiceOf: () => ({ id: "i1", number: "INV-003", customerId: "c1" }),
        customerOf: () => ({ id: "c1", name: "Zelda Ortiz", number: "C-001" }),
      },
    );
    const lines = csv.replace(/^﻿/, "").split("\r\n");
    expect(lines[0]).toBe(PAYMENT_EXPORT_HEADER.join(","));
    expect(lines[1]).toBe(
      "2026-04-02,INV-003,C-001,Zelda Ortiz,zelle,25.00,ZL-1",
    );
  });
});

describe("REQ-795 the Reports page's pure helpers", () => {
  test("six slices, each with its href, from/to appended only when set", () => {
    expect(REPORT_SLICES.map((s) => s.id)).toEqual([
      "invoices",
      "unpaid",
      "paid",
      "payments",
      "quotes",
      "customers",
    ]);
    expect(reportExportHref("invoices", {})).toBe(
      "/api/invoices/export.csv?status=all",
    );
    expect(reportExportHref("unpaid", {})).toBe(
      "/api/invoices/export.csv?status=unpaid",
    );
    expect(reportExportHref("paid", { from: "2026-01-01", to: "2026-01-31" }))
      .toBe(
        "/api/invoices/export.csv?status=paid&from=2026-01-01&to=2026-01-31",
      );
    expect(reportExportHref("payments", { from: "2026-01-01" })).toBe(
      "/api/payments/export.csv?from=2026-01-01",
    );
    expect(reportExportHref("quotes", { to: "2026-01-31" })).toBe(
      "/api/quotes/export.csv?to=2026-01-31",
    );
    expect(reportExportHref("customers", {})).toBe("/api/customers/export.csv");
  });
  test("presets resolve against a given day; All time is unbounded", () => {
    const now = new Date("2026-11-13T15:00:00Z");
    expect(presetRange("all", now)).toEqual({});
    expect(presetRange("thisMonth", now)).toEqual({
      from: "2026-11-01",
      to: "2026-11-30",
    });
    expect(presetRange("lastMonth", now)).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(presetRange("thisYear", now)).toEqual({
      from: "2026-01-01",
      to: "2026-12-31",
    });
    expect(presetRange("lastYear", now)).toEqual({
      from: "2025-01-01",
      to: "2025-12-31",
    });
    expect(presetRange("lastMonth", new Date("2026-01-10T00:00:00Z"))).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });
  test("a range is valid when both ends are days (or empty) and from is not after to", () => {
    expect(isValidRange({})).toBe(true);
    expect(isValidRange({ from: "2026-01-01" })).toBe(true);
    expect(isValidRange({ from: "2026-01-01", to: "2026-01-01" })).toBe(true);
    expect(isValidRange({ from: "2026-02-01", to: "2026-01-01" })).toBe(false);
    expect(isValidRange({ from: "bogus" })).toBe(false);
  });
  test("Reports is the last root sidebar row, linking /reports, in both dictionaries", () => {
    const root = viewAt(NAV, []).items;
    const last = root[root.length - 1];
    expect(last.id).toBe("reports");
    expect(last.href).toBe("/reports");
    const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
    const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
    expect(en["nav.reports"]).toBe("Reports");
    expect(es["nav.reports"]).toBe("Informes");
    for (
      const k of [
        "reportsPage.docTitle",
        "reportsPage.title",
        "reportsPage.download",
        "reportsPage.errRange",
        "reportsPage.slice.paid",
        "reportsPage.preset.lastMonth",
      ]
    ) {
      expect(en[k]).toBeTruthy();
      expect(es[k]).toBeTruthy();
    }
    const route = read("front-end/routes/reports/index.tsx");
    expect(route).toMatch(/<DashSidebar active="reports"/);
  });
});
