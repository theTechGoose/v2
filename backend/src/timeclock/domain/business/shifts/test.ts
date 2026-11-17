/** REQ-192 — the timeclock's pure rules (ported from the Mallard Group timeclock's punches.ts). */
import { assertEquals } from "#std/assert";
import {
  checkFlip,
  checkManualPunch,
  dayStartIn,
  deriveShifts,
  lastStatus,
  sumShifts,
  weekBoundsIn,
} from "./mod.ts";

const p = (id: string, type: "in" | "out", at: string) => ({ id, type, at });

Deno.test("REQ-192 lastStatus — the last punch wins; nothing means out", () => {
  assertEquals(lastStatus([]), { status: "out", since: null });
  assertEquals(lastStatus([p("a", "in", "2026-11-02T13:00:00.000Z")]), {
    status: "in",
    since: "2026-11-02T13:00:00.000Z",
  });
  assertEquals(
    lastStatus([
      p("a", "in", "2026-11-02T13:00:00.000Z"),
      p("b", "out", "2026-11-02T17:00:00.000Z"),
    ]).status,
    "out",
  );
});

Deno.test("REQ-192 checkFlip — a punch must flip the state: in while in is already_in, out while out is not_in", () => {
  assertEquals(checkFlip(null, "in"), null);
  assertEquals(checkFlip(null, "out"), "not_in");
  assertEquals(
    checkFlip(p("a", "in", "2026-11-02T13:00:00.000Z"), "in"),
    "already_in",
  );
  assertEquals(
    checkFlip(p("a", "in", "2026-11-02T13:00:00.000Z"), "out"),
    null,
  );
  assertEquals(
    checkFlip(p("a", "out", "2026-11-02T13:00:00.000Z"), "out"),
    "not_in",
  );
});

Deno.test("REQ-192 checkManualPunch — alternates with both neighbours; an out needs an in before it", () => {
  const IN = p("i", "in", "2026-11-02T13:00:00.000Z"),
    OUT = p("o", "out", "2026-11-02T17:00:00.000Z");
  assertEquals(checkManualPunch(null, null, "in"), null);
  assertEquals(checkManualPunch(null, null, "out"), "out_without_in");
  assertEquals(checkManualPunch(IN, null, "in"), "same_as_prev");
  assertEquals(checkManualPunch(null, IN, "in"), "same_as_next");
  assertEquals(checkManualPunch(IN, null, "out"), null);
  assertEquals(checkManualPunch(OUT, null, "out"), "same_as_prev");
  assertEquals(checkManualPunch(IN, OUT, "out"), "same_as_next");
  assertEquals(checkManualPunch(OUT, IN, "in"), "same_as_next");
});

Deno.test("REQ-192 deriveShifts — pairs in/out; an in followed by an in is a missing_out anomaly; a stray out is missing_in; the trailing in is an open shift that ticks", () => {
  const now = "2026-11-02T20:00:00.000Z";
  const { shifts, anomalies } = deriveShifts([
    p("1", "in", "2026-11-02T13:00:00.000Z"),
    p("2", "out", "2026-11-02T17:00:00.000Z"),
    p("3", "out", "2026-11-02T17:30:00.000Z"),
    p("4", "in", "2026-11-02T18:00:00.000Z"),
    p("5", "in", "2026-11-02T19:00:00.000Z"),
  ], now);
  assertEquals(shifts.length, 3);
  assertEquals(shifts[0], {
    inPunchId: "1",
    outPunchId: "2",
    start: "2026-11-02T13:00:00.000Z",
    end: "2026-11-02T17:00:00.000Z",
    durationMs: 4 * 3_600_000,
    open: false,
    anomaly: null,
  });
  assertEquals(shifts[1], {
    inPunchId: "4",
    outPunchId: null,
    start: "2026-11-02T18:00:00.000Z",
    end: null,
    durationMs: null,
    open: false,
    anomaly: "missing_out",
  });
  assertEquals(shifts[2], {
    inPunchId: "5",
    outPunchId: null,
    start: "2026-11-02T19:00:00.000Z",
    end: null,
    durationMs: 3_600_000,
    open: true,
    anomaly: null,
  });
  assertEquals(anomalies, [
    { punchId: "3", kind: "missing_in", at: "2026-11-02T17:30:00.000Z" },
    { punchId: "4", kind: "missing_out", at: "2026-11-02T18:00:00.000Z" },
  ]);
  assertEquals(
    sumShifts(shifts),
    5 * 3_600_000,
    "the unclosed anomaly adds nothing; the open shift counts so far",
  );
});

Deno.test("REQ-192 weekBoundsIn / dayStartIn — Monday 00:00 to next Monday 00:00 in the zone, as instants", () => {
  // Thu 2026-11-05 21:30 New York (EST, UTC-5) = 2026-11-06T02:30Z — still Thursday in New York
  const now = new Date("2026-11-06T02:30:00.000Z");
  assertEquals(weekBoundsIn("America/New_York", now), {
    from: "2026-11-02T05:00:00.000Z",
    to: "2026-11-09T05:00:00.000Z",
  });
  assertEquals(dayStartIn("America/New_York", now), "2026-11-05T05:00:00.000Z");
  // a Sunday belongs to the week that started the Monday before
  assertEquals(
    weekBoundsIn("America/New_York", new Date("2026-11-08T12:00:00.000Z")).from,
    "2026-11-02T05:00:00.000Z",
  );
  // across the DST change (Nov 1 2026, 2 am): the week of Oct 26 starts in EDT and ends in EST
  assertEquals(
    weekBoundsIn("America/New_York", new Date("2026-10-29T12:00:00.000Z")),
    { from: "2026-10-26T04:00:00.000Z", to: "2026-11-02T05:00:00.000Z" },
  );
});
