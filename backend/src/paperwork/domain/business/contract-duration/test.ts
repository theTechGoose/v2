import { assertEquals } from "#std/assert";
import { durationDays } from "./mod.ts";

Deno.test("durationDays: null when either date missing", () => {
  assertEquals(durationDays({}), null);
  assertEquals(durationDays({ startDate: "2026-04-01" }), null);
});

Deno.test("durationDays: counts whole days between start and completion", () => {
  assertEquals(
    durationDays({ startDate: "2026-04-01", estimatedCompletionDate: "2026-04-11" }),
    10,
  );
});

Deno.test("durationDays: clamps to 0 when end before start", () => {
  assertEquals(
    durationDays({ startDate: "2026-04-11", estimatedCompletionDate: "2026-04-01" }),
    0,
  );
});
