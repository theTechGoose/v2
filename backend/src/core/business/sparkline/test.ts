import { assertEquals } from "#std/assert";
import {
  bucketBy12Months,
  lastMonthRevenue,
  monthOverMonthPct,
  type RevenueRow,
  ytdRevenue,
} from "./mod.ts";

// Anchor "now" to the middle of a month so off-by-one issues at month
// boundaries don't bite the test.
const NOW = new Date(Date.UTC(2026, 3, 15));    // Apr 15, 2026

const row = (paidAt: string, amountCents: number): RevenueRow => ({ paidAt, amountCents });

Deno.test("bucketBy12Months: 12 zero-filled buckets when no rows", () => {
  assertEquals(bucketBy12Months([], NOW), new Array(12).fill(0));
});

Deno.test("bucketBy12Months: a row in the current month lands at index 11", () => {
  const out = bucketBy12Months([row("2026-04-10T00:00:00Z", 1_000)], NOW);
  assertEquals(out[11], 1_000);
  assertEquals(out.slice(0, 11).every((v) => v === 0), true);
});

Deno.test("bucketBy12Months: a row from previous month lands at index 10", () => {
  const out = bucketBy12Months([row("2026-03-20T00:00:00Z", 5_000)], NOW);
  assertEquals(out[10], 5_000);
});

Deno.test("bucketBy12Months: a row from 12 months ago lands at index 0", () => {
  // Apr 15, 2026 minus 11 months = May 2025 (index 0 in a 12-bucket array including current).
  const out = bucketBy12Months([row("2025-05-01T00:00:00Z", 999)], NOW);
  assertEquals(out[0], 999);
});

Deno.test("bucketBy12Months: rows older than 11 months are dropped", () => {
  const out = bucketBy12Months([row("2024-12-01T00:00:00Z", 999)], NOW);
  assertEquals(out.reduce((a, b) => a + b, 0), 0);
});

Deno.test("bucketBy12Months: rows newer than current month are dropped", () => {
  const out = bucketBy12Months([row("2026-05-01T00:00:00Z", 999)], NOW);
  assertEquals(out.reduce((a, b) => a + b, 0), 0);
});

Deno.test("bucketBy12Months: amounts in the same month accumulate", () => {
  const out = bucketBy12Months([
    row("2026-04-01T00:00:00Z", 100),
    row("2026-04-15T00:00:00Z", 200),
    row("2026-04-29T00:00:00Z", 300),
  ], NOW);
  assertEquals(out[11], 600);
});

Deno.test("bucketBy12Months: malformed paidAt is skipped, not crashed-on", () => {
  const out = bucketBy12Months([
    row("not-a-date", 999),
    row("2026-04-01T00:00:00Z", 100),
  ], NOW);
  assertEquals(out[11], 100);
});

Deno.test("bucketBy12Months: negative amounts clamp to 0 (paranoid; bookkeeping bug shouldn't drag down the chart)", () => {
  const out = bucketBy12Months([row("2026-04-01T00:00:00Z", -999)], NOW);
  assertEquals(out[11], 0);
});

Deno.test("ytdRevenue: only counts rows from current calendar year", () => {
  const out = ytdRevenue([
    row("2025-12-31T23:59:59Z", 5_000),     // outside YTD
    row("2026-01-15T00:00:00Z", 1_000),
    row("2026-04-01T00:00:00Z", 2_000),
    row("2027-01-01T00:00:00Z", 999),       // future — also dropped
  ], NOW);
  assertEquals(out, 3_000);
});

Deno.test("lastMonthRevenue: returns the previous month's bucket", () => {
  const out = lastMonthRevenue([
    row("2026-03-15T00:00:00Z", 4_180),
    row("2026-04-10T00:00:00Z", 999),       // current month, ignored
  ], NOW);
  assertEquals(out, 4_180);
});

Deno.test("monthOverMonthPct: positive growth", () => {
  // Feb: 1000, Mar: 1240 → +24%
  const out = monthOverMonthPct([
    row("2026-02-01T00:00:00Z", 1_000),
    row("2026-03-01T00:00:00Z", 1_240),
  ], NOW);
  assertEquals(out, 24);
});

Deno.test("monthOverMonthPct: negative growth", () => {
  // Feb: 2000, Mar: 1500 → -25%
  const out = monthOverMonthPct([
    row("2026-02-01T00:00:00Z", 2_000),
    row("2026-03-01T00:00:00Z", 1_500),
  ], NOW);
  assertEquals(out, -25);
});

Deno.test("monthOverMonthPct: prior-month zero returns 0 (no /0)", () => {
  const out = monthOverMonthPct([
    row("2026-03-01T00:00:00Z", 1_500),
  ], NOW);
  assertEquals(out, 0);
});
