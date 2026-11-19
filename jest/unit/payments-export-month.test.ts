/**
 * REQ-1129 (LOOP-007 cycle 3, q3-57) — AMENDMENT of REQ-019 / REQ-926.
 * Raphael (LOOP-007): "test every single aspect of this application … one
 * Opus agent per issue to do root cause analysis, then one to write the
 * test, then one to fix it and make it green".
 * REQ-019: "Export this month" on /payments "downloads this month's payments
 * as a CSV" — not the paid-invoices export; and a charged-back payment is
 * in that CSV, marked as such.
 */
import * as fs from "fs";
import * as path from "path";
import {
  PAYMENT_EXPORT_HEADER,
  paymentExportCsv,
} from "../../shared/documents/exports";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-1129 q3-57 /payments 'Export this month' downloads the payments CSV", () => {
  const island = read("front-end/islands/PaymentsPage.tsx");
  const at = island.indexOf("const exportHref");
  const decl = island.slice(at, island.indexOf(";", at) + 1);

  test("REQ-1129 the exportHref is built against /api/payments/export.csv, not the invoice export", () => {
    expect(at).toBeGreaterThan(-1);
    expect(decl).not.toContain("/api/invoices/export.csv");
    expect(decl).toMatch(/\/api\/payments\/export\.csv|reportExportHref\(\s*["']payments["']/);
  });
});

describe("REQ-1129 q3-57 paymentExportCsv marks a charged-back payment", () => {
  const rows = [
    {
      id: "p1",
      invoiceId: "i1",
      amount: 254442,
      method: "zelle",
      receivedAt: "2026-11-19T15:00:00.000Z",
    },
    {
      id: "p2",
      invoiceId: "i2",
      amount: 40025,
      method: "check",
      receivedAt: "2026-11-19T16:00:00.000Z",
      reference: "CHK 1042",
      reversedAt: "2026-11-19T17:00:00.000Z",
      reversedFeeCents: 3500,
    },
  ];
  const csv = paymentExportCsv(rows, {
    invoiceOf: (p) => ({ id: p.invoiceId, number: p.invoiceId === "i1" ? "INV-001" : "INV-002" }),
    customerOf: () => undefined,
  });
  const lines = csv.trim().split(/\r?\n/);

  test("REQ-1129 the header carries a Status column", () => {
    expect([...PAYMENT_EXPORT_HEADER]).toContain("Status");
  });

  test("REQ-1129 the charged-back check reads charged back; the Zelle does not", () => {
    const statusAt = (PAYMENT_EXPORT_HEADER as readonly string[]).indexOf("Status");
    expect(statusAt).toBeGreaterThan(-1);
    const check = lines.find((l) => l.includes("400.25"))!.split(",");
    const zelle = lines.find((l) => l.includes("2544.42"))!.split(",");
    expect(check[statusAt]).toMatch(/charged back/i);
    expect(zelle[statusAt]).not.toMatch(/charged back/i);
  });
});
