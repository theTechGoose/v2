/**
 * REQ-478 — demo-loop cycle 3, demo issue M32: "Invoice KPI tiles all $0
 * while a reported payment awaits confirmation". The demo saw, on /invoices
 * with INV-001 $450 "Pago reportado":
 *
 *   hero:  "1 pago esperando tu confirmación."
 *   tiles: "VENCIDA $0 · ENVIADAS PARA COBRO $0 · 0 en camino · PAGADAS ESTE MES $0"
 *
 * RCA (runs/re05e1cbb, M32): InvoicesPage put a claimed invoice in its own
 * `claimed` bucket; outstandingTotal and outTotal summed only overdue + out,
 * and InvoicesKpis got no claimed value — a $450 claim sat in no tile. Totals
 * also summed `amount`, not the balance still owed (amount − paidCents).
 *
 * The derivation lives in front-end/lib/headline-counts.ts (invoiceKpiTotals);
 * the island is bound to it below.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { invoiceKpiTotals } from "../../front-end/lib/headline-counts";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
const island = read("front-end/islands/InvoicesPage.tsx");

describe("REQ-478 (M32): a claimed invoice is counted in the KPI tiles", () => {
  it("a lone $450 claim shows in 'Out for payment' and the outstanding total", () => {
    const t = invoiceKpiTotals([{ stage: "claimed", amount: 45000 }]);
    expect(t.claimedCount).toBe(1);
    expect(t.claimedCents).toBe(45000);
    expect(t.outTileCents).toBe(45000);
    expect(t.outstandingCents).toBe(45000);
    expect(t.overdueCents).toBe(0);
  });

  it("out + claimed sum into the 'Out for payment' tile; overdue stays its own tile", () => {
    const t = invoiceKpiTotals([
      { stage: "out", amount: 10000 },
      { stage: "claimed", amount: 45000 },
      { stage: "overdue", amount: 20000 },
      { stage: "drafting", amount: 99900 },
      { stage: "scheduled", amount: 50000 },
      { stage: "paid", amount: 70000, paidCents: 70000 },
    ]);
    expect(t.outCount).toBe(1);
    expect(t.outCents).toBe(10000);
    expect(t.outTileCents).toBe(55000);
    expect(t.overdueCents).toBe(20000);
    expect(t.outstandingCents).toBe(75000);
  });

  it("totals are the balance still owed (amount − paidCents), not the face amount", () => {
    const t = invoiceKpiTotals([
      { stage: "out", amount: 100000, paidCents: 40000 },
      { stage: "claimed", amount: 45000, paidCents: 5000 },
      { stage: "overdue", amount: 30000, paidCents: 10000 },
    ]);
    expect(t.outCents).toBe(60000);
    expect(t.claimedCents).toBe(40000);
    expect(t.overdueCents).toBe(20000);
    expect(t.outstandingCents).toBe(120000);
  });

  it("an overpaid or missing amount never makes a negative/NaN balance", () => {
    const t = invoiceKpiTotals([
      { stage: "out", amount: 10000, paidCents: 12000 },
      { stage: "out" },
    ]);
    expect(t.outCents).toBe(0);
    expect(t.outstandingCents).toBe(0);
  });
});

describe("REQ-478 (M32): the island reads invoiceKpiTotals and tells the tile about claims", () => {
  it("InvoicesPage derives its totals from invoiceKpiTotals", () => {
    expect(island).toMatch(/invoiceKpiTotals\(/);
    expect(island).not.toMatch(/\[\.\.\.overdue, \.\.\.out\]\.reduce/);
  });
  it("InvoicesKpis receives the claimed count", () => {
    const kpis = island.slice(island.indexOf("<InvoicesKpis"));
    expect(kpis.slice(0, kpis.indexOf("/>"))).toMatch(/claimedCount=/);
  });
  it("the 'Out for payment' sub-line says how many await confirmation (en + es)", () => {
    for (const dict of [en, es]) {
      for (const k of ["one", "other"]) {
        const v = dict[`invoicesPage.kpi.outSubClaimed.${k}`];
        expect(v).toBeDefined();
        expect(v).toContain("{n}");
        expect(v).toContain("{c}");
      }
    }
    expect(en["invoicesPage.kpi.outSubClaimed.one"]).toBe(
      "{n} on the way · {c} awaiting your confirmation",
    );
    expect(island).toMatch(/invoicesPage\.kpi\.outSubClaimed/);
  });
});
