/**
 * REQ-325 (demo-loop cycle 1, issue m38): the /payments "Cash-flow shape"
 * chart buckets landed payments by the ISO week of receivedAt over the last
 * 12 weeks ending today, and its three axis labels come from those dates
 * (today-11w, today-6w, today) through dashboardPage.month.* — not the
 * prototype's fixed "Feb / Mar / Apr".
 *
 * Proposes front-end/lib/cash-flow-weeks.ts:
 *   cashFlowWeeks(payments: { receivedAt: string; amount: number }[], now: Date)
 *     → { weeks: number[12]; labels: [MonthKey, MonthKey, MonthKey] }
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// Lazy so a missing module reds only the tests that use it.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const lib = () => require("../../front-end/lib/cash-flow-weeks");

// The demo's day: Thursday 12 Nov 2026 (ISO week starts Mon 9 Nov).
// Instants sit at noon UTC so they fall on the same calendar day in any host
// timezone — the module buckets in LOCAL time, as a browser would for its user.
const NOW = new Date("2026-11-12T15:00:00Z");
const p = (receivedAt: string, amount: number) => ({ receivedAt, amount });

describe("REQ-325 m38 — cashFlowWeeks buckets landed payments by ISO week of receivedAt", () => {
  it("REQ-325: a payment received this week lands in the rightmost bucket", () => {
    const { weeks } = lib().cashFlowWeeks([p("2026-11-10T10:00:00Z", 500_00)], NOW);
    expect(weeks).toHaveLength(12);
    expect(weeks[11]).toBe(500_00);
    expect(weeks.slice(0, 11).every((v: number) => v === 0)).toBe(true);
  });

  it("REQ-325: payments on known dates fill their own week, summed per week", () => {
    const { weeks } = lib().cashFlowWeeks(
      [
        p("2026-11-12T12:00:00Z", 100_00), // this week → 11
        p("2026-11-04T12:00:00Z", 200_00), // last week → 10
        p("2026-11-06T12:00:00Z", 50_00), // last week too → 10
        p("2026-10-01T12:00:00Z", 300_00), // week of Mon 28 Sep → 6 weeks back → 5
        p("2026-08-24T12:00:00Z", 400_00), // Mon 24 Aug → 11 weeks back → 0
      ],
      NOW,
    );
    expect(weeks[11]).toBe(100_00);
    expect(weeks[10]).toBe(250_00);
    expect(weeks[5]).toBe(300_00);
    expect(weeks[0]).toBe(400_00);
    expect(weeks.reduce((s: number, v: number) => s + v, 0)).toBe(1050_00);
  });

  it("REQ-325: the week boundary is Monday — Sunday 8 Nov is last week, Monday 9 Nov is this week", () => {
    const { weeks } = lib().cashFlowWeeks(
      [p("2026-11-08T12:00:00Z", 1_00), p("2026-11-09T12:00:00Z", 2_00)],
      NOW,
    );
    expect(weeks[10]).toBe(1_00);
    expect(weeks[11]).toBe(2_00);
  });

  it("REQ-325: a payment 12+ weeks back or in the future is outside the window", () => {
    const { weeks } = lib().cashFlowWeeks(
      [p("2026-08-23T12:00:00Z", 9_00), p("2026-03-01T12:00:00Z", 9_00), p("2026-11-20T12:00:00Z", 9_00)],
      NOW,
    );
    expect(weeks.every((v: number) => v === 0)).toBe(true);
  });

  it("REQ-325: on 12 Nov the axis reads august · october · november (today-11w, today-6w, today), not feb/mar/apr", () => {
    const { labels } = lib().cashFlowWeeks([], NOW);
    expect(labels).toEqual(["august", "october", "november"]);
  });

  it("REQ-325: the axis follows today across a year end", () => {
    const { labels } = lib().cashFlowWeeks([], new Date("2027-01-20T12:00:00Z"));
    expect(labels).toEqual(["november", "december", "january"]);
  });

  it("REQ-325: every label is a dashboardPage.month key in en and es", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    for (const m of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
      const { labels } = lib().cashFlowWeeks([], new Date(Date.UTC(2026, m, 15)));
      for (const key of labels) {
        expect(typeof en[`dashboardPage.month.${key}`]).toBe("string");
        expect(typeof es[`dashboardPage.month.${key}`]).toBe("string");
      }
    }
  });
});

describe("REQ-325 m38 — PaymentsPage wires the module and the fixed month keys are gone", () => {
  const island = () => read("front-end/islands/PaymentsPage.tsx");

  it("REQ-325: PSideFlow uses cashFlowWeeks over the landed payments' receivedAt", () => {
    const src = island();
    expect(src).toMatch(/from "\.\.\/lib\/cash-flow-weeks\.ts"/);
    expect(src).toMatch(/cashFlowWeeks\(/);
    expect(src).not.toMatch(/weeks\[11 - \(i % 12\)\]/);
  });

  it("REQ-325: the island renders the labels through dashboardPage.month.* and no paymentsPage.flow.feb/mar/apr", () => {
    const src = island();
    expect(src).not.toMatch(/paymentsPage\.flow\.(feb|mar|apr)/);
    expect(src).toMatch(/dashboardPage\.month\.\$\{/);
  });

  it("REQ-325: lang/en.json and lang/es.json no longer carry paymentsPage.flow.feb/mar/apr", () => {
    for (const f of ["lang/en.json", "lang/es.json"]) {
      const dict = JSON.parse(read(f));
      expect(dict["paymentsPage.flow.feb"]).toBeUndefined();
      expect(dict["paymentsPage.flow.mar"]).toBeUndefined();
      expect(dict["paymentsPage.flow.apr"]).toBeUndefined();
    }
  });
});
