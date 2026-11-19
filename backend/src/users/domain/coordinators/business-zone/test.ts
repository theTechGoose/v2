/** REQ-940 (q1-11) — the account's field day is in the business's zone: picked → state → FIELD_TZ → New York */
import { assertEquals } from "#std/assert";
import { dayIn, resolveBusinessZone } from "./mod.ts";

Deno.test("REQ-940 resolveBusinessZone: the picked zone, else the state's, else FIELD_TZ, else New York", () => {
  assertEquals(
    resolveBusinessZone({
      timezone: "America/Chicago",
      state: "CA",
      fallback: "UTC",
    }),
    "America/Chicago",
  );
  assertEquals(
    resolveBusinessZone({ state: "CA", fallback: "UTC" }),
    "America/Los_Angeles",
  );
  assertEquals(
    resolveBusinessZone({
      timezone: "Not/AZone",
      state: "zz",
      fallback: "UTC",
    }),
    "UTC",
  );
  assertEquals(resolveBusinessZone({}), "America/New_York");
});

Deno.test("REQ-940 the field day at 2026-11-19T04:30Z is Nov 18 in Chicago and Los Angeles, Nov 19 in UTC", () => {
  const now = new Date("2026-11-19T04:30:00Z");
  assertEquals(
    dayIn(resolveBusinessZone({ timezone: "America/Chicago" }), now),
    "2026-11-18",
  );
  assertEquals(dayIn(resolveBusinessZone({ state: "CA" }), now), "2026-11-18");
  assertEquals(dayIn("UTC", now), "2026-11-19");
});
