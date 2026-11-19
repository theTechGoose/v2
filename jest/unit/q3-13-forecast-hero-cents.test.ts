/**
 * REQ-1089 (LOOP-007 cycle 3, issues q3-13 + q3-14) — Raphael: "test every
 * single aspect of this application … one Opus agent per issue to do root
 * cause analysis, then one to write the test, then one to fix it and make it
 * green."
 *
 * q3-13: one $1,000.50 invoice due this week — the /invoices hero read
 * "$1,001 expected this week" while the line under it read
 * "Thu: Greg Pruitt $1,000.50".
 * q3-14: one $225.30 overdue invoice — the hero read "⚠ $225 at risk" while
 * the Overdue tile on the same screen read "$225.30".
 *
 * The forecast amounts are exact sums of invoice amounts (backend
 * compute-invoice-forecast), so REQ-961's total rule applies: fmtMoneyTotal
 * (cents unless the total is whole), never the rounding fmtMoney. The hero is
 * an inner function of the InvoicesPage island, mounted after the client
 * fetch, so this pins the formatter each hero amount goes through; the e2e
 * story e2e/forecast-hero-cents drives the same screen live.
 */
import * as fs from "fs";
import * as path from "path";
import { fmtMoney, fmtMoneyTotal } from "../../front-end/lib/format.ts";

const ROOT = path.resolve(__dirname, "../..");
const invoices = fs.readFileSync(
  path.join(ROOT, "front-end/islands/InvoicesPage.tsx"),
  "utf8",
);

/** every formatter call that wraps `expr` in the island */
function formattersOf(src: string, expr: string): string[] {
  const esc = expr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...src.matchAll(new RegExp(`(\\w+)\\(\\s*${esc}\\s*\\)`, "g"))]
    .map((m) => m[1]);
}

describe("REQ-1089 q3-13/q3-14: the /invoices forecast hero shows its exact totals to the cent", () => {
  it("REQ-1089: the formatters — 100050 is $1,000.50 and 22530 is $225.30 as a total; fmtMoney rounds them", () => {
    expect(fmtMoneyTotal(100_050)).toBe("$1,000.50");
    expect(fmtMoneyTotal(100_000)).toBe("$1,000");
    expect(fmtMoneyTotal(22_530)).toBe("$225.30");
    expect(fmtMoney(100_050)).toBe("$1,001");
    expect(fmtMoney(22_530)).toBe("$225");
  });

  const sites: Array<[string, string]> = [
    ["q3-13 'expected this week' hero", "forecast!.thisWeekCents"],
    ["q3-13 'coming next week' hero", "forecast!.nextWeekCents"],
    ["q3-14 'at risk' line", "forecast!.atRiskCents"],
  ];
  for (const [name, expr] of sites) {
    it(`REQ-1089: the ${name} formats ${expr} with fmtMoneyTotal, never the rounding fmtMoney`, () => {
      const used = formattersOf(invoices, expr);
      expect(used.length).toBeGreaterThan(0);
      expect(used).not.toContain("fmtMoney");
      expect(used.every((f) => f === "fmtMoneyTotal")).toBe(true);
    });
  }
});
