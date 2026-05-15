import { assertEquals } from "#std/assert";
import { computeMilestoneAmounts, computeScheduledDates } from "./mod.ts";
import type { ContractTerm } from "@paperwork/dto/contract.ts";

function pterms(value: string): ContractTerm[] {
  return [{ stepId: "payment_terms", label: "Payment", value }];
}

Deno.test("computeMilestoneAmounts: 50/50 → two equal halves, sum = total", () => {
  const out = computeMilestoneAmounts(100_00, pterms("50/50"));
  assertEquals(out, [50_00, 50_00]);
  assertEquals(out.reduce((s, n) => s + n, 0), 100_00);
});

Deno.test("computeMilestoneAmounts: 30/30/40 → three milestones, last absorbs rounding", () => {
  // 333_00 doesn't split cleanly into 30/30/40 — verify the sum still
  // equals the total exactly (rounding goes into the last milestone).
  const out = computeMilestoneAmounts(333_00, pterms("30/30/40"));
  assertEquals(out.length, 3);
  assertEquals(out.reduce((s, n) => s + n, 0), 333_00);
  assertEquals(out[0], Math.round(333_00 * 0.30));
  assertEquals(out[1], Math.round(333_00 * 0.30));
});

Deno.test("computeMilestoneAmounts: 'upon completion' / 'net 15' → one milestone, full total", () => {
  assertEquals(computeMilestoneAmounts(500_00, pterms("Payment upon completion")), [500_00]);
  assertEquals(computeMilestoneAmounts(500_00, pterms("net 15")), [500_00]);
});

Deno.test("computeMilestoneAmounts: 'deposit + balance' → 20/80", () => {
  const out = computeMilestoneAmounts(1000_00, pterms("Deposit + balance"));
  assertEquals(out.length, 2);
  assertEquals(out[0], 200_00);
  assertEquals(out[1], 800_00);
});

Deno.test("computeMilestoneAmounts: unknown terms → 30/70 default split", () => {
  // No "50/50" / "30/30/40" / "completion" / "deposit" → falls through to
  // the conservative default. Sum still equals total.
  const out = computeMilestoneAmounts(1000_00, pterms("haggle in person"));
  assertEquals(out.length, 2);
  assertEquals(out[0], 300_00);
  assertEquals(out[1], 700_00);
});

Deno.test("computeMilestoneAmounts: zero/negative total → empty", () => {
  assertEquals(computeMilestoneAmounts(0, pterms("50/50")), []);
  assertEquals(computeMilestoneAmounts(-100, pterms("50/50")), []);
});

Deno.test("computeScheduledDates: 3 milestones over a 14-day window, equal spacing", () => {
  const today = new Date("2026-05-01T00:00:00Z");
  const dates = computeScheduledDates(3, "2026-05-01", "2026-05-15", today);
  // First slot is today (callers ignore it — first invoice fires
  // immediately). Subsequent slots are evenly spaced over [start, end].
  assertEquals(dates.length, 3);
  assertEquals(dates[0], "2026-05-01");
  assertEquals(dates[1], "2026-05-08"); // halfway
  assertEquals(dates[2], "2026-05-15"); // end of window
});

Deno.test("computeScheduledDates: missing window → defaults to 14-day fallback", () => {
  const today = new Date("2026-05-01T00:00:00Z");
  const dates = computeScheduledDates(3, undefined, undefined, today);
  assertEquals(dates.length, 3);
  // Window collapses to 14 days from today: halfway at +7d, end at +14d.
  assertEquals(dates[1], "2026-05-08");
  assertEquals(dates[2], "2026-05-15");
});

Deno.test("computeScheduledDates: single-milestone case → only today's slot", () => {
  const today = new Date("2026-05-01T00:00:00Z");
  const dates = computeScheduledDates(1, "2026-05-01", "2026-05-30", today);
  assertEquals(dates, ["2026-05-01"]);
});

Deno.test("computeScheduledDates: zero-day window is clamped so dates don't collide", () => {
  // start === end shouldn't make every milestone date the same. The helper
  // forces at least a 1-day window in that case.
  const today = new Date("2026-05-01T00:00:00Z");
  const dates = computeScheduledDates(2, "2026-05-01", "2026-05-01", today);
  assertEquals(dates.length, 2);
  // First slot is today; second slot has shifted forward by the clamped 1-day window.
  assertEquals(dates[0], "2026-05-01");
  assertEquals(dates[1], "2026-05-02");
});
