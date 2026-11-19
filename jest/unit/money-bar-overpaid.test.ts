/**
 * REQ-1137 (LOOP-007 q3, q3-67) — the dashboard money bar's paid bucket follows REQ-551:
 * every "paid" KPI counts what was collected against the bill, min(paid, amount). An
 * overpaid invoice (INV-002: $1,035.50 billed, $1,100.00 received) shows $1,035.50 on its
 * row and in the 30-day paid total, never the $64.50 overpaid rest.
 */
import { buildMoneyBar } from "../../shared/receivables/money-bar.ts";

const NOW = new Date("2026-11-19T15:00:00Z");

const overpaid = {
  id: "i-over",
  status: "paid",
  amount: 103_550,
  paidCents: 110_000,
  paidAt: "2026-11-19T14:00:00Z",
  dueDate: "2026-12-01",
  customerId: "c1",
  number: "INV-002",
  updatedAt: "2026-11-19T14:00:00Z",
};
const exact = {
  id: "i-exact",
  status: "paid",
  amount: 20_000,
  paidCents: 20_000,
  paidAt: "2026-11-18T14:00:00Z",
  dueDate: "2026-12-01",
  customerId: "c1",
  number: "INV-001",
  updatedAt: "2026-11-18T14:00:00Z",
};

const build = (invoices: typeof overpaid[]) =>
  buildMoneyBar({
    quotes: [],
    jobs: [],
    invoices,
    customerNames: new Map([["c1", "Ana"]]),
    now: NOW,
  });

describe("REQ-1137 (q3-67): the money bar's paid bucket counts min(paid, amount)", () => {
  it("REQ-1137: an overpaid invoice's paid row is the $1,035.50 billed, not the $1,100.00 received", () => {
    const paid = build([overpaid]).buckets.find((b) => b.key === "paid")!;
    expect(paid.items).toHaveLength(1);
    expect(paid.items[0].cents).toBe(103_550);
  });

  it("REQ-1137: the 30-day paid total and the bar total leave out the $64.50 overpaid rest", () => {
    const data = build([overpaid, exact]);
    const paid = data.buckets.find((b) => b.key === "paid")!;
    expect(paid.cents).toBe(103_550 + 20_000);
    expect(data.totalCents).toBe(103_550 + 20_000);
  });

  it("REQ-1137: an exactly-paid invoice still counts its full amount", () => {
    const paid = build([exact]).buckets.find((b) => b.key === "paid")!;
    expect(paid.items[0].cents).toBe(20_000);
    expect(paid.cents).toBe(20_000);
  });
});
