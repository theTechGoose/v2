import { assertEquals } from "#std/assert";
import { applyTo, isBalanced, nextDue, pastDue, totalPercent } from "./mod.ts";

const sched = [
  { percent: 40, dueDate: "2026-04-01" },
  { percent: 40, dueDate: "2026-05-01" },
  { percent: 20, dueDate: "2026-06-01" },
];

Deno.test("totalPercent: sums installment percents", () => {
  assertEquals(totalPercent(sched), 100);
});

Deno.test("totalPercent: empty schedule is 0", () => {
  assertEquals(totalPercent([]), 0);
});

Deno.test("isBalanced: true when percents add to 100", () => {
  assertEquals(isBalanced(sched), true);
});

Deno.test("isBalanced: false when percents miss 100", () => {
  assertEquals(isBalanced([{ percent: 50 }, { percent: 30 }]), false);
});

Deno.test("applyTo: resolves percents into dollar amounts", () => {
  const resolved = applyTo(sched, 1280);
  assertEquals(resolved[0].amount, 512);
  assertEquals(resolved[1].amount, 512);
  assertEquals(resolved[2].amount, 256);
});

Deno.test("applyTo: 50/50 against 1280 splits evenly", () => {
  const resolved = applyTo(
    [
      { percent: 50, dueDate: "2026-04-01" },
      { percent: 50, dueDate: "2026-05-01" },
    ],
    1280,
  );
  assertEquals(resolved[0].amount, 640);
  assertEquals(resolved[1].amount, 640);
});

Deno.test("nextDue: returns the earliest installment on/after now", () => {
  const now = new Date("2026-04-15T00:00:00Z");
  assertEquals(nextDue(sched, now)?.dueDate, "2026-05-01");
});

Deno.test("nextDue: null when nothing remains", () => {
  const now = new Date("2026-07-01T00:00:00Z");
  assertEquals(nextDue(sched, now), null);
});

Deno.test("pastDue: returns all installments that fell before now, oldest first", () => {
  const now = new Date("2026-05-15T00:00:00Z");
  const overdue = pastDue(sched, now);
  assertEquals(overdue.length, 2);
  assertEquals(overdue[0].dueDate, "2026-04-01");
  assertEquals(overdue[1].dueDate, "2026-05-01");
});
