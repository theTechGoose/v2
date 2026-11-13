/** REQ-139 — a subscription's schedule: when it is due, and how it reads. */
import { assertEquals } from "#std/assert";
import { isDue, isValidDate, scheduleText, todayIn } from "./mod.ts";
import type { Subscription } from "@field/dto/field.ts";

const sub = (o: Partial<Subscription> = {}): Subscription => ({
  id: "s",
  userId: "u",
  customerId: "c",
  address: "a",
  lat: 0,
  lng: 0,
  items: [{ taskTypeId: "1", priceCents: 6500 }],
  cadence: "weekly",
  active: true,
  createdAt: "2026-10-05T12:00:00.000Z",
  updatedAt: "2026-10-05T12:00:00.000Z",
  ...o,
});

Deno.test("REQ-139 isDue — weekly/biweekly/monthly from the start date, never before it", () => {
  const weekly = sub();
  assertEquals([
    isDue(weekly, "2026-10-05"),
    isDue(weekly, "2026-10-12"),
    isDue(weekly, "2026-10-13"),
    isDue(weekly, "2026-09-28"),
  ], [true, true, false, false]);
  const bi = sub({ cadence: "biweekly" });
  assertEquals([isDue(bi, "2026-10-12"), isDue(bi, "2026-10-19")], [
    false,
    true,
  ]);
  const monthly = sub({ cadence: "monthly", startDate: "2026-01-31" });
  assertEquals([
    isDue(monthly, "2026-02-28"),
    isDue(monthly, "2026-03-31"),
    isDue(monthly, "2026-03-30"),
    isDue(monthly, "2026-02-27"),
  ], [true, true, false, false]);
});

Deno.test("REQ-139 isDue — weekdays + every N weeks; the default weekday is the start date's", () => {
  // 2026-10-05 is a Monday
  const monThu = sub({ startDate: "2026-10-05", days: [1, 4] });
  assertEquals(
    ["2026-10-05", "2026-10-08", "2026-10-06", "2026-10-12", "2026-10-15"].map((
      d,
    ) => isDue(monThu, d)),
    [true, true, false, true, true],
  );
  const tue3 = sub({ startDate: "2026-10-05", days: [2], intervalWeeks: 3 });
  assertEquals(
    ["2026-10-06", "2026-10-13", "2026-10-20", "2026-10-27"].map((d) =>
      isDue(tue3, d)
    ),
    [true, false, false, true],
  );
  const plain = sub({ startDate: "2026-10-07" }); // a Wednesday
  assertEquals([isDue(plain, "2026-10-14"), isDue(plain, "2026-10-15")], [
    true,
    false,
  ]);
});

Deno.test("REQ-139 scheduleText — in words, both languages", () => {
  assertEquals(
    scheduleText(sub({ startDate: "2026-10-05", days: [1, 4] }), "es"),
    "Cada semana · lun, jue",
  );
  assertEquals(
    scheduleText(
      sub({ startDate: "2026-10-05", days: [2], intervalWeeks: 3 }),
      "en",
    ),
    "Every 3 weeks · Tue",
  );
  assertEquals(
    scheduleText(sub({ cadence: "monthly", startDate: "2026-10-05" }), "es"),
    "Mensual · día 5",
  );
});

Deno.test("REQ-139 isValidDate — a real calendar day, YYYY-MM-DD", () => {
  assertEquals(isValidDate("2026-02-30"), false);
  assertEquals(isValidDate("2026-10-28"), true);
  assertEquals(isValidDate("not-a-date"), false);
  assertEquals(isValidDate(20261028), false);
});

Deno.test("REQ-141 todayIn — the company's day in its time zone, not the UTC day", () => {
  // 03:30 UTC on Oct 29 is still Oct 28 in New York
  assertEquals(
    todayIn("America/New_York", new Date("2026-10-29T03:30:00Z")),
    "2026-10-28",
  );
  assertEquals(todayIn("UTC", new Date("2026-10-29T03:30:00Z")), "2026-10-29");
});

Deno.test("REQ-157 isDue — monthly on the picked days, clamped to the month's last day; two picks on one last day are one visit; no picks = the old single-day rule", () => {
  const m = sub({
    cadence: "monthly",
    startDate: "2026-01-01",
    daysOfMonth: [15, 31],
  });
  assertEquals(
    [
      "2026-01-15",
      "2026-01-31",
      "2026-02-15",
      "2026-02-28",
      "2026-02-27",
      "2026-04-30",
      "2026-04-29",
      "2026-03-31",
    ].map((d) => isDue(m, d)),
    [true, true, true, true, false, true, false, true],
  );
  const collapse = sub({
    cadence: "monthly",
    startDate: "2026-01-01",
    daysOfMonth: [30, 31],
  });
  assertEquals(
    ["2026-02-28", "2026-02-27", "2026-03-30", "2026-03-31"].map((d) =>
      isDue(collapse, d)
    ),
    [true, false, true, true],
  );
  const old = sub({ cadence: "monthly", startDate: "2026-01-31" });
  assertEquals([isDue(old, "2026-02-28"), isDue(old, "2026-02-15")], [
    true,
    false,
  ]);
  const empty = sub({
    cadence: "monthly",
    startDate: "2026-01-31",
    daysOfMonth: [],
  });
  assertEquals([isDue(empty, "2026-02-28"), isDue(empty, "2026-02-15")], [
    true,
    false,
  ]);
  assertEquals(isDue(m, "2025-12-31"), false, "never before the start");
});

Deno.test("REQ-157 scheduleText — the picked days in words, singular and plural, both languages", () => {
  assertEquals(
    scheduleText(
      sub({
        cadence: "monthly",
        startDate: "2026-01-01",
        daysOfMonth: [15, 31],
      }),
      "en",
    ),
    "Monthly · days 15, 31",
  );
  assertEquals(
    scheduleText(
      sub({
        cadence: "monthly",
        startDate: "2026-01-01",
        daysOfMonth: [15, 31],
      }),
      "es",
    ),
    "Mensual · días 15, 31",
  );
  assertEquals(
    scheduleText(
      sub({ cadence: "monthly", startDate: "2026-01-01", daysOfMonth: [15] }),
      "en",
    ),
    "Monthly · day 15",
  );
  assertEquals(
    scheduleText(sub({ cadence: "monthly", startDate: "2026-10-05" }), "en"),
    "Monthly · day 5",
  );
});

// REQ-699 (demo-loop cycle 5, M20): a quote's recurring term may end — the
// subscription it became bills nothing after that day.
Deno.test("REQ-699 isDue: nothing is due after the subscription's endDate", () => {
  const ending = sub({
    cadence: "monthly",
    startDate: "2026-11-19",
    endDate: "2027-01-31",
  });
  assertEquals([
    isDue(ending, "2026-12-19"),
    isDue(ending, "2027-01-19"),
    isDue(ending, "2027-02-19"),
  ], [true, true, false]);
  const weekly = sub({ startDate: "2026-11-16", endDate: "2026-11-23" });
  assertEquals([
    isDue(weekly, "2026-11-23"),
    isDue(weekly, "2026-11-30"),
  ], [true, false]);
});
