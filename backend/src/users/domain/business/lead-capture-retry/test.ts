// REQ-072 — the lead capture's retry clock: when a pending capture is due again, and how the
// wait grows. Pure.
import { assert, assertEquals } from "#std/assert";
import { backoffMs, isDue, MAX_BACKOFF_MS } from "./mod.ts";

Deno.test("REQ-072 backoff — doubles from 5 s and never passes five minutes", () => {
  assertEquals([0, 1, 2, 3, 4].map(backoffMs), [5_000, 10_000, 20_000, 40_000, 80_000]);
  assertEquals(backoffMs(6), MAX_BACKOFF_MS);
  assertEquals(backoffMs(40), MAX_BACKOFF_MS);
  assertEquals(MAX_BACKOFF_MS, 5 * 60_000);
});

Deno.test("REQ-072 isDue — due when its time has come and nobody holds a live lease", () => {
  const now = Date.parse("2026-10-14T20:00:00Z");
  const rec = { phone: "+15125550072", enqueuedAt: "2026-10-14T19:59:00Z", attempts: 0, nextAt: "2026-10-14T20:00:00Z" };
  assert(isDue(rec, now), "its time has come");
  assert(!isDue({ ...rec, nextAt: "2026-10-14T20:00:01Z" }, now), "not yet");
  assert(!isDue({ ...rec, leaseUntil: "2026-10-14T20:00:30Z" }, now), "another sweep holds it");
  assert(isDue({ ...rec, leaseUntil: "2026-10-14T19:59:59Z" }, now), "a stale lease does not hold it");
});
