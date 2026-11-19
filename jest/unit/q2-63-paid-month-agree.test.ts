/**
 * REQ-1074 (LOOP-007 cycle 2, issue q2-63) — Raphael: "test every single
 * aspect of this application … one Opus agent per issue to do root cause
 * analysis, then one to write the test, then one to fix it and make it green."
 *
 * q2-63: after a $500 check on a $1,190.75 invoice, /invoices showed
 * "PAID THIS MONTH $500 · 0 cleared" beside track 06 "0 invoices — Nothing
 * paid yet this month", and the hero read "$691 on the way" beside the Out
 * tile's "$690.75". The hero and the track are inside the InvoicesPage
 * island (mounted only after the client fetch), so this pins the source;
 * e2e/paid-month-agree drives the same screen live.
 */
import * as fs from "fs";
import * as path from "path";
import { fmtMoney, fmtMoneyTotal } from "../../front-end/lib/format.ts";

const ROOT = path.resolve(__dirname, "../..");
const invoices = fs.readFileSync(
  path.join(ROOT, "front-end/islands/InvoicesPage.tsx"),
  "utf8",
);

describe("REQ-1074 q2-63: /invoices 'paid this month' and the hero total agree with the tiles", () => {
  it("REQ-1074: the formatters — 69075 cents is $690.75 as a total and $691 rounded", () => {
    expect(fmtMoneyTotal(69075)).toBe("$690.75");
    expect(fmtMoney(69075)).toBe("$691");
  });

  it("REQ-1074: the hero's outstanding total is formatted to the cent (fmtMoneyTotal), like the Out tile", () => {
    const m = invoices.match(/<em>\{(\w+)\(outstandingTotal\)\}<\/em>/);
    expect(m).not.toBeNull();
    expect(m![1]).toBe("fmtMoneyTotal");
  });

  it("REQ-1074: track 06 and the tile subline do not count only stage-'paid' invoices while the tile value counts every payment", () => {
    const usesPaymentsValue = /paidThisMonthCents\(/.test(invoices);
    const stageOnly =
      /const paidThisMonth = enriched\.filter\(\(i\) =>\s*i\.stage === "paid" && i\.paidAt && new Date\(i\.paidAt\) >= monthCutoff\s*\);/
        .test(invoices);
    const trackCount = /count=\{paidThisMonth\.length\}/.test(invoices);
    const subCount = /paidCount=\{paidThisMonth\.length\}/.test(invoices);
    expect(usesPaymentsValue).toBe(true);
    expect({ stageOnly, trackCount, subCount }).not.toEqual({
      stageOnly: true,
      trackCount: true,
      subCount: true,
    });
  });
});
