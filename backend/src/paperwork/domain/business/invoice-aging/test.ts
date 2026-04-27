import { assertEquals } from "#std/assert";
import { isOverdue } from "./mod.ts";

const now = new Date("2026-05-01T00:00:00Z");

Deno.test("isOverdue: paid invoices are never overdue", () => {
  assertEquals(isOverdue({ dueDate: "2026-04-01", paidAt: "2026-04-30" }, now), false);
  assertEquals(isOverdue({ dueDate: "2026-04-01", status: "paid" }, now), false);
});

Deno.test("isOverdue: dueDate before now and unpaid → overdue", () => {
  assertEquals(isOverdue({ dueDate: "2026-04-15" }, now), true);
});

Deno.test("isOverdue: dueDate after now → not overdue", () => {
  assertEquals(isOverdue({ dueDate: "2026-05-15" }, now), false);
});
