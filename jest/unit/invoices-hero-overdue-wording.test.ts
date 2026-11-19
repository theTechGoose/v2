/**
 * REQ-958 — LOOP-007 cycle 1, QA issue q1-33 [BUG_CONTRADICTION]: the
 * /invoices money bar contradicts itself for an overdue invoice. With one
 * $1,000 invoice past due the tester read:
 *
 *   hero:  "$1,000 on the way across 1 invoice."
 *   tile:  "OUT FOR PAYMENT $0 · 0 on the way"
 *
 * RCA: the hero's fallback "outstanding" headline prints outstandingCents
 * (overdue + out + claimed, REQ-566) with invoicesPage.hero.onTheWay, while
 * the "Out for payment" tile prints outTileCents (out + claimed only) with
 * invoicesPage.kpi.outSub "{n} on the way". Overdue money is called "on the
 * way" in the hero and is not "on the way" in the tile beside it.
 *
 * The fix picks the hero's wording through a helper in
 * front-end/lib/headline-counts.ts — invoicesHeroOutstandingKey(overdueCount)
 * — so the rule is testable; the island must render through it.
 */
import { readFileSync } from "fs";
import { join } from "path";
import * as hc from "../../front-end/lib/headline-counts";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
const island = read("front-end/islands/InvoicesPage.tsx");

// deno-lint-ignore no-explicit-any
const keyHelper = (hc as any).invoicesHeroOutstandingKey as
  | ((overdueCount: number) => string)
  | undefined;

const OVERDUE_ONLY = [{ stage: "overdue", amount: 100000 }];

describe("REQ-958 (LOOP-007 q1-33): the /invoices hero never calls overdue money 'on the way'", () => {
  it("REQ-958: one overdue $1,000 invoice → hero mode 'outstanding' over $1,000, Out tile $0", () => {
    const t = hc.invoiceKpiTotals(OVERDUE_ONLY);
    expect(t.overdueCents).toBe(100000);
    expect(t.outTileCents).toBe(0);
    expect(t.outstandingCents).toBe(100000);
    const mode = hc.invoicesHeroMode({
      totalInvoiceCount: 1,
      outstandingCount: t.overdueCount + t.outCount,
      claimedCount: t.claimedCount,
      outstandingCents: t.outstandingCents,
    });
    expect(mode).toBe("outstanding");
  });

  it("REQ-958: headline-counts exports invoicesHeroOutstandingKey(overdueCount)", () => {
    expect(typeof keyHelper).toBe("function");
  });

  it("REQ-958: with an overdue balance in the total, the hero key reads neither 'on the way' (en) nor 'en camino' (es)", () => {
    const t = hc.invoiceKpiTotals(OVERDUE_ONLY);
    const key = keyHelper ? keyHelper(t.overdueCount) : "invoicesPage.hero.onTheWay";
    expect(en[key]).toBeDefined();
    expect(es[key]).toBeDefined();
    expect(en[key]).not.toMatch(/on the way/i);
    expect(es[key]).not.toMatch(/en camino/i);
  });

  it("REQ-958: the 'outstanding' hero renders its wording through invoicesHeroOutstandingKey, not the Out tile's phrase", () => {
    expect(/invoicesHeroOutstandingKey\(/.test(island)).toBe(true);
    // the hero h1 no longer hard-codes invoicesPage.hero.onTheWay
    const h1 = island.slice(
      island.indexOf('data-cy="forecast-hero"'),
      island.indexOf("</h1>", island.indexOf('data-cy="forecast-hero"')),
    );
    expect(/tFor\(lang, "invoicesPage\.hero\.onTheWay"\)/.test(h1)).toBe(false);
  });
});
