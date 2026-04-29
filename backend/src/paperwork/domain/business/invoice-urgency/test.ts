import { assertEquals } from "#std/assert";
import { deriveUrgency } from "./mod.ts";

const NOW = new Date(Date.UTC(2026, 3, 15)); // Apr 15, 2026

Deno.test("invoice-urgency: paid status → paid", () => {
  assertEquals(deriveUrgency({ dueDate: "2026-03-01", status: "paid", paidAt: "2026-03-10T00:00:00Z" }, NOW), "paid");
});

Deno.test("invoice-urgency: paidAt set with no status → paid", () => {
  assertEquals(deriveUrgency({ dueDate: "2026-03-01", status: "pending", paidAt: "2026-03-10T00:00:00Z" }, NOW), "paid");
});

Deno.test("invoice-urgency: pending, far in the future → current", () => {
  assertEquals(deriveUrgency({ dueDate: "2026-05-15", status: "pending" }, NOW), "current");
});

Deno.test("invoice-urgency: pending, due within 7 days → soon", () => {
  assertEquals(deriveUrgency({ dueDate: "2026-04-20", status: "pending" }, NOW), "soon");
});

Deno.test("invoice-urgency: overdue 1-30 days → overdue15d", () => {
  assertEquals(deriveUrgency({ dueDate: "2026-04-10", status: "pending" }, NOW), "overdue15d");
  assertEquals(deriveUrgency({ dueDate: "2026-03-20", status: "pending" }, NOW), "overdue15d");
});

Deno.test("invoice-urgency: overdue >30 days → overdue30plus", () => {
  assertEquals(deriveUrgency({ dueDate: "2026-03-01", status: "pending" }, NOW), "overdue30plus");
  assertEquals(deriveUrgency({ dueDate: "2025-11-01", status: "pending" }, NOW), "overdue30plus");
});
