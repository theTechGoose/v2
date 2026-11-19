/**
 * REQ-943 (LOOP-007 cycle 1, q1-9) — /payments never shows a payment dated
 * after today as "Today", never counts it this month and never averages it
 * into days to pay (QA: 2027-06-01 on 2026-11-19 → "Hoy", "$1,250 este mes",
 * "194d"). The page's day rules, pure.
 */
import { assert, assertEquals } from "@std/assert";
import {
  calendarDaysAgo,
  daysToPayOf,
  isThisMonthSoFar,
} from "./payments-partition.ts";

const NOW = new Date(2026, 10, 19, 9, 0, 0); // 2026-11-19 09:00 local
const noon = (y: number, m: number, d: number) =>
  new Date(y, m - 1, d, 12, 0, 0).toISOString();

Deno.test("REQ-943 (q1-9): a payment dated 2027-06-01 is not today, not this month, not in days to pay", () => {
  const at = noon(2027, 6, 1);
  assert(calendarDaysAgo(at, NOW) < 0, "negative, never clamped to 0");
  assertEquals(isThisMonthSoFar(at, NOW), false);
  assertEquals(daysToPayOf(at, "2026-11-19", NOW), null);
});

Deno.test("REQ-943 (q1-9): tomorrow is already outside this month so far", () => {
  const at = noon(2026, 11, 20);
  assertEquals(calendarDaysAgo(at, NOW), -1);
  assertEquals(isThisMonthSoFar(at, NOW), false);
});

Deno.test("REQ-943 (q1-9): today's noon payment (after 9 am now) is still today and this month", () => {
  const at = noon(2026, 11, 19);
  assertEquals(calendarDaysAgo(at, NOW), 0);
  assertEquals(isThisMonthSoFar(at, NOW), true);
  assertEquals(daysToPayOf(at, "2026-11-12", NOW), 7);
});

Deno.test("REQ-943 (q1-9): yesterday and the 1st count; last month does not", () => {
  assertEquals(calendarDaysAgo(noon(2026, 11, 18), NOW), 1);
  assertEquals(isThisMonthSoFar(noon(2026, 11, 1), NOW), true);
  assertEquals(isThisMonthSoFar(noon(2026, 10, 31), NOW), false);
});

Deno.test("REQ-943 (q1-9): unparseable dates never count", () => {
  assert(Number.isNaN(calendarDaysAgo("not a date", NOW)));
  assertEquals(isThisMonthSoFar("not a date", NOW), false);
  assertEquals(daysToPayOf("not a date", "2026-11-01", NOW), null);
  assertEquals(daysToPayOf(noon(2026, 11, 18), undefined, NOW), null);
});
