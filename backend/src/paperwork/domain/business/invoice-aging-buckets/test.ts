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

Deno.test("aging-buckets: future-due pending → current", () => {
  const buckets = bucketPendingInvoices([
    { dueDate: "2026-05-15", status: "pending" },
    { dueDate: "2026-04-30", status: "pending" },
  ], NOW);
  assertEquals(buckets.current, 2);
});

Deno.test("aging-buckets: overdue 1-14 days bucket", () => {
  const buckets = bucketPendingInvoices([
    { dueDate: "2026-04-28", status: "pending" }, // 1 day overdue
    { dueDate: "2026-04-15", status: "pending" }, // 14 days overdue
  ], NOW);
  assertEquals(buckets.aging1_14d, 2);
});

Deno.test("aging-buckets: overdue 15-30 days bucket", () => {
  const buckets = bucketPendingInvoices([
    { dueDate: "2026-04-14", status: "pending" }, // 15 days overdue
    { dueDate: "2026-03-30", status: "pending" }, // 30 days overdue
  ], NOW);
  assertEquals(buckets.overdue15_30d, 2);
});

Deno.test("aging-buckets: overdue >30 days bucket", () => {
  const buckets = bucketPendingInvoices([
    { dueDate: "2026-03-29", status: "pending" }, // 31 days overdue
    { dueDate: "2025-12-01", status: "pending" }, // very stale
  ], NOW);
  assertEquals(buckets.overdue30plus, 2);
});

Deno.test("aging-buckets: full-spectrum mix", () => {
  const buckets = bucketPendingInvoices([
    { dueDate: "2026-05-01", status: "pending" },                                  // current
    { dueDate: "2026-04-25", status: "pending" },                                  // 4d → aging1_14d
    { dueDate: "2026-04-10", status: "pending" },                                  // 19d → overdue15_30d
    { dueDate: "2025-11-01", status: "pending" },                                  // overdue30plus
    { dueDate: "2026-03-01", status: "paid", paidAt: "2026-03-15T00:00:00Z" },     // ignored
  ], NOW);
  assertEquals(buckets, { current: 1, aging1_14d: 1, overdue15_30d: 1, overdue30plus: 1 });
});
