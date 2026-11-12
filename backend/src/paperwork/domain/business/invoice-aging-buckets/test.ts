import { assertEquals } from "#std/assert";
import { bucketPendingInvoices } from "./mod.ts";

const NOW = new Date(Date.UTC(2026, 3, 29)); // Apr 29, 2026

Deno.test("aging-buckets: paid invoices excluded from all buckets", () => {
  const buckets = bucketPendingInvoices([
    { dueDate: "2026-03-01", status: "paid", paidAt: "2026-03-15T00:00:00Z" },
    { dueDate: "2026-03-01", status: "paid" },
  ], NOW);
  assertEquals(buckets, { current: 0, aging1_14d: 0, overdue15_30d: 0, overdue30plus: 0 });
});

Deno.test("aging-buckets: future-due pending → current (REQ-397: summed balance cents)", () => {
  const buckets = bucketPendingInvoices([
    { dueDate: "2026-05-15", status: "pending", amount: 100_00 },
    { dueDate: "2026-04-30", status: "pending", amount: 250_00 },
  ], NOW);
  assertEquals(buckets.current, 350_00);
});

Deno.test("aging-buckets: overdue 1-14 days bucket", () => {
  const buckets = bucketPendingInvoices([
    { dueDate: "2026-04-28", status: "pending", amount: 10_00 }, // 1 day overdue
    { dueDate: "2026-04-15", status: "pending", amount: 20_00 }, // 14 days overdue
  ], NOW);
  assertEquals(buckets.aging1_14d, 30_00);
});

Deno.test("aging-buckets: overdue 15-30 days bucket", () => {
  const buckets = bucketPendingInvoices([
    { dueDate: "2026-04-14", status: "pending", amount: 10_00 }, // 15 days overdue
    { dueDate: "2026-03-30", status: "pending", amount: 20_00 }, // 30 days overdue
  ], NOW);
  assertEquals(buckets.overdue15_30d, 30_00);
});

Deno.test("aging-buckets: overdue >30 days bucket", () => {
  const buckets = bucketPendingInvoices([
    { dueDate: "2026-03-29", status: "pending", amount: 10_00 }, // 31 days overdue
    { dueDate: "2025-12-01", status: "pending", amount: 20_00 }, // very stale
  ], NOW);
  assertEquals(buckets.overdue30plus, 30_00);
});

Deno.test("aging-buckets: full-spectrum mix", () => {
  const buckets = bucketPendingInvoices([
    { dueDate: "2026-05-01", status: "sent", amount: 1_00 },                       // current
    { dueDate: "2026-04-25", status: "viewed", amount: 2_00 },                     // 4d → aging1_14d
    { dueDate: "2026-04-10", status: "claimed", amount: 3_00 },                    // 19d → overdue15_30d
    { dueDate: "2025-11-01", status: "pending", amount: 4_00 },                    // overdue30plus
    { dueDate: "2026-03-01", status: "paid", paidAt: "2026-03-15T00:00:00Z", amount: 9_00 }, // ignored
  ], NOW);
  assertEquals(buckets, { current: 1_00, aging1_14d: 2_00, overdue15_30d: 3_00, overdue30plus: 4_00 });
});

// REQ-397 (demo-loop cycle 2, M14): the buckets are MONEY (cents), not
// invoice counts. Two unpaid invoices used to read "Current $0.02" because
// each added 1 and the dashboard divides by 100.
Deno.test("REQ-397 aging-buckets: an accepted 50/50 job's sent deposit is its balance in cents; the scheduled half is not owed yet", () => {
  const buckets = bucketPendingInvoices([
    { dueDate: "2026-05-06", status: "sent", amount: 960_000 },
    { dueDate: "2026-06-01", status: "scheduled", amount: 960_000 },
  ], NOW);
  assertEquals(buckets, { current: 960_000, aging1_14d: 0, overdue15_30d: 0, overdue30plus: 0 });
});

Deno.test("REQ-397 aging-buckets: a partly paid invoice counts what is still owed; draft and void count nothing", () => {
  const buckets = bucketPendingInvoices([
    { dueDate: "2026-05-06", status: "pending", amount: 500_00, paidCents: 200_00 },
    { dueDate: "2026-05-06", status: "draft", amount: 100_00 },
    { dueDate: "2026-03-01", status: "void", amount: 100_00 },
  ], NOW);
  assertEquals(buckets, { current: 300_00, aging1_14d: 0, overdue15_30d: 0, overdue30plus: 0 });
});
