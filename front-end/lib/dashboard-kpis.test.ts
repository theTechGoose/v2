import { assertEquals } from "@std/assert";
import { pickKpis } from "./dashboard-kpis.ts";
import type { DashboardStats } from "../clients/dashboard.ts";

// REQ-397 (demo-loop cycle 2, M14): the aging buckets are CENTS. Outstanding
// is what they add up to — no clamp on the invoice count (the old "stray
// sub-dollar cents" clamp hid buckets that counted invoices, not money).

function stats(
  buckets: DashboardStats["invoices"]["agingBuckets"],
  pending: number,
  overdue = 0,
): DashboardStats {
  return {
    customers: 1,
    quotes: { total: 1, draft: 0, sent: 0, accepted: 1 },
    invoices: { total: 2, pending, paid: 0, overdue, agingBuckets: buckets },
    quotedValueCents: 0,
    awaitingResponse: 0,
    revenue: {
      ytdCents: 0,
      lastMonthCents: 0,
      monthOverMonthPct: 0,
      sparkline12mo: new Array(12).fill(0),
    },
    payments: { receivedYtdCents: 0, methodMixCents: {}, topPayors: [] },
  } as unknown as DashboardStats;
}

Deno.test("REQ-397 pickKpis: a $9,600 sent deposit reads $9,600 outstanding across 1 invoice, current $9,600", () => {
  const k = pickKpis(stats(
    { current: 9_600_00, aging1_14d: 0, overdue15_30d: 0, overdue30plus: 0 },
    1,
  ));
  assertEquals(k.outstanding, 9_600);
  assertEquals(k.outstandingCount, 1);
  assertEquals(k.current, 9_600);
  assertEquals(k.owed, 9_600);
});

Deno.test("REQ-397 pickKpis: Outstanding is the buckets' money, never clamped by the count", () => {
  const k = pickKpis(stats(
    {
      current: 100_00,
      aging1_14d: 50_00,
      overdue15_30d: 25_00,
      overdue30plus: 0,
    },
    0,
  ));
  assertEquals(k.outstanding, 175);
  assertEquals(k.outstanding, k.owed);
});
