/** REQ-924 — the customer workspace's pure rules: the money summary, the monthly estimate per cadence,
 *  the next visits by the schedule, and which done visits are not billed yet. */
import { assertEquals } from "#std/assert";
import {
  isUnbilled,
  monthlyVisits,
  nextVisits,
  perVisitCents,
  workspaceSummary,
} from "./mod.ts";
import type { Subscription } from "@field/dto/field.ts";

const sub = (over: Partial<Subscription>): Subscription => ({
  id: "s1",
  userId: "u",
  customerId: "c1",
  address: "1 Main St",
  lat: 0,
  lng: 0,
  items: [{ taskTypeId: "t1", priceCents: 9500 }, { taskTypeId: "t2", priceCents: 4500 }],
  cadence: "weekly",
  startDate: "2026-10-06",
  active: true,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...over,
} as Subscription);

Deno.test("REQ-924 perVisitCents — the sum of a visit's service prices", () => {
  assertEquals(perVisitCents(sub({})), 14000);
  assertEquals(perVisitCents(sub({ items: [] })), 0);
});

Deno.test("REQ-924 monthlyVisits — weekly × weeks-per-month ÷ interval, monthly × days, annual ÷ 12", () => {
  const wpm = 52 / 12;
  assertEquals(monthlyVisits(sub({ cadence: "weekly", days: [2] })), wpm);
  assertEquals(monthlyVisits(sub({ cadence: "weekly", days: [1, 4] })), 2 * wpm);
  assertEquals(monthlyVisits(sub({ cadence: "weekly", days: [5], intervalWeeks: 2 })), wpm / 2);
  assertEquals(monthlyVisits(sub({ cadence: "biweekly", days: [5] })), wpm / 2);
  assertEquals(monthlyVisits(sub({ cadence: "monthly", daysOfMonth: [1, 15] })), 2);
  assertEquals(monthlyVisits(sub({ cadence: "monthly", startDate: "2026-03-15" })), 1);
  assertEquals(monthlyVisits(sub({ cadence: "annual", daysOfMonth: [5], month: 3 })), 1 / 12);
});

Deno.test("REQ-924 nextVisits — the schedule's next dates from today (inclusive), none when paused or ended", () => {
  // 2026-11-17 is a Tuesday
  const tue = sub({ cadence: "weekly", days: [2], startDate: "2026-10-06" });
  assertEquals(nextVisits(tue, "2026-11-17", 3), ["2026-11-17", "2026-11-24", "2026-12-01"]);
  assertEquals(nextVisits(tue, "2026-11-18", 2), ["2026-11-24", "2026-12-01"]);
  const monthly = sub({ cadence: "monthly", daysOfMonth: [3], startDate: "2026-08-03" });
  assertEquals(nextVisits(monthly, "2026-11-18", 2), ["2026-12-03", "2027-01-03"]);
  assertEquals(nextVisits(sub({ active: false, days: [2] }), "2026-11-17", 3), []);
  assertEquals(nextVisits(sub({ days: [2], endDate: "2026-11-20" }), "2026-11-17", 3), ["2026-11-17"]);
  // REQ-924: a day whose visit is already done or skipped is not "next"
  assertEquals(nextVisits(tue, "2026-11-17", 2, new Set(["2026-11-17"])), ["2026-11-24", "2026-12-01"]);
  assertEquals(nextVisits(tue, "2026-11-17", 1, new Set(["2026-11-24"])), ["2026-11-17"]);
  // a start in the future: the first visit is on or after the start
  assertEquals(nextVisits(sub({ cadence: "weekly", days: [2], startDate: "2026-12-01" }), "2026-11-17", 1), ["2026-12-01"]);
});

Deno.test("REQ-924 isUnbilled — a completed visit whose invoice is missing or not live", () => {
  const live = new Set(["inv-live"]);
  assertEquals(isUnbilled({ status: "complete" }, live), true);
  assertEquals(isUnbilled({ status: "complete", invoiceId: "inv-void" }, live), true);
  assertEquals(isUnbilled({ status: "complete", invoiceId: "inv-live" }, live), false);
  assertEquals(isUnbilled({ status: "assigned" }, live), false);
  assertEquals(isUnbilled({ status: "skipped" }, live), false);
  assertEquals(isUnbilled({ status: "complete", deleted: true }, live), false);
});

Deno.test("REQ-924 workspaceSummary — owed, overdue, billed, paid, last payment, open quotes, recurring", () => {
  const today = "2026-11-18";
  const s = workspaceSummary({
    today,
    invoices: [
      { id: "a", status: "sent", amount: 420000, paidCents: 150000, dueDate: "2026-11-01" }, // overdue 2,700
      { id: "b", status: "viewed", amount: 185000, dueDate: "2026-12-10" }, // owed, not due
      { id: "c", status: "paid", amount: 35000, paidCents: 35000, dueDate: "2026-07-14", paidAt: "2026-07-02" },
      { id: "d", status: "draft", amount: 99900, dueDate: "2026-12-30" }, // not billed yet
      { id: "e", status: "void", amount: 50000, dueDate: "2026-09-01" },
      { id: "f", status: "credit", amount: 10000, dueDate: "2026-09-01" }, // a credit lowers what is owed
    ],
    payments: [
      { amount: 150000, method: "zelle", receivedAt: "2026-10-15" },
      { amount: 35000, method: "card", receivedAt: "2026-07-02" },
    ],
    quotes: [
      { status: "sent", estimatedTotal: 310000 },
      { status: "accepted", acceptedAt: "2026-09-20", estimatedTotal: 420000 },
      { status: "draft", estimatedTotal: 90000 },
    ],
    services: [
      { active: true, perVisitCents: 14000, monthlyVisits: 52 / 12, nextVisit: "2026-11-24" },
      { active: true, perVisitCents: 60000, monthlyVisits: 1 / 3, nextVisit: "2026-12-15" },
      { active: false, perVisitCents: 12000, monthlyVisits: 52 / 24, nextVisit: undefined },
    ],
    unbilledVisitCents: [14000, 14000, 14000],
  });
  assertEquals(s.owedCents, 270000 + 185000 - 10000);
  assertEquals(s.overdueCents, 270000);
  assertEquals(s.billedCents, 420000 + 185000 + 35000);
  assertEquals(s.paidCents, 150000 + 35000);
  assertEquals(s.lastPayment, { amountCents: 150000, method: "zelle", receivedAt: "2026-10-15" });
  assertEquals([s.openQuotes, s.openQuotesCents], [1, 310000]);
  assertEquals(s.activeServices, 2);
  assertEquals(s.recurringMonthlyCents, Math.round(14000 * 52 / 12 + 60000 / 3));
  assertEquals(s.nextVisit, "2026-11-24");
  assertEquals([s.unbilledVisits, s.unbilledCents], [3, 42000]);
});

Deno.test("REQ-924 workspaceSummary — a new customer: everything zero, no last payment, no next visit", () => {
  const s = workspaceSummary({ today: "2026-11-18", invoices: [], payments: [], quotes: [], services: [], unbilledVisitCents: [] });
  assertEquals(s, {
    owedCents: 0,
    overdueCents: 0,
    billedCents: 0,
    paidCents: 0,
    openQuotes: 0,
    openQuotesCents: 0,
    activeServices: 0,
    recurringMonthlyCents: 0,
    unbilledVisits: 0,
    unbilledCents: 0,
  });
});

// REQ-1063 (LOOP-007 q2, q2-52) — the RECURRING figure honours a repeat visit's end date (REQ-1004).
// A weekly $85 Thursday visit from Nov 26 that ends Dec 31: 6 visits ($510) left on Nov 19; once Dec 31
// is past it is ended — no longer counted as active nor in the monthly figure, even though active=true.
const ending = sub({ items: [{ taskTypeId: "t1", priceCents: 8500 }], cadence: "weekly", days: [4], startDate: "2026-11-26", endDate: "2026-12-31" });

Deno.test("REQ-1063 (LOOP-007 q2, q2-52) nextVisits — a weekly $85 visit ending Dec 31 has 6 visits ($510) left on Nov 19", () => {
  const left = nextVisits(ending, "2026-11-19", 1000);
  assertEquals(left, ["2026-11-26", "2026-12-03", "2026-12-10", "2026-12-17", "2026-12-24", "2026-12-31"]);
  assertEquals(left.length * perVisitCents(ending), 51000);
});

Deno.test("REQ-1063 (LOOP-007 q2, q2-52) workspaceSummary — a service whose end date has passed is neither active nor recurring", () => {
  // still active=true in the store: nobody paused it, it simply ran out on Dec 31
  const ended = { active: true, perVisitCents: 8500, monthlyVisits: 52 / 12, endDate: "2026-12-31", nextVisit: undefined };
  const s = workspaceSummary({ today: "2027-01-05", invoices: [], payments: [], quotes: [], services: [ended], unbilledVisitCents: [] });
  assertEquals(s.activeServices, 0, "an ended service is not an active one");
  assertEquals(s.recurringMonthlyCents, 0, "an ended service adds nothing per month");
});

Deno.test("REQ-1063 (LOOP-007 q2, q2-52) workspaceSummary — a running service with an end date says when the recurring income ends", () => {
  const running = { active: true, perVisitCents: 8500, monthlyVisits: 52 / 12, endDate: "2026-12-31", nextVisit: "2026-11-26" };
  const open = { active: true, perVisitCents: 14000, monthlyVisits: 52 / 12, nextVisit: "2026-11-24" };
  const s = workspaceSummary({ today: "2026-11-19", invoices: [], payments: [], quotes: [], services: [running, open], unbilledVisitCents: [] });
  assertEquals(s.activeServices, 2);
  assertEquals(s.recurringMonthlyCents, Math.round(8500 * 52 / 12 + 14000 * 52 / 12), "the /mo rate stays (REQ-924)");
  assertEquals((s as unknown as Record<string, unknown>).recurringEndsOn, "2026-12-31", "the earliest end date among the running services");
  const none = workspaceSummary({ today: "2026-11-19", invoices: [], payments: [], quotes: [], services: [open], unbilledVisitCents: [] });
  assertEquals((none as unknown as Record<string, unknown>).recurringEndsOn, undefined, "no end date, no 'until'");
});
