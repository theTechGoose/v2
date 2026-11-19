/**
 * REQ-955 (LOOP-007 q1-30) — the card's open count and its timeline share one
 * merge rule: views of a quote collapse to at most one open per hour.
 */
import { assertEquals } from "#std/assert";
import { mergeOpensByHour } from "./mod.ts";

const v = (viewedAt: string, id = viewedAt) => ({ id, viewedAt });

Deno.test("REQ-955 (LOOP-007 q1-30): two loads a minute apart are one open", () => {
  const out = mergeOpensByHour([
    v("2026-11-17T10:01:00.000Z"),
    v("2026-11-17T10:00:00.000Z"),
  ]);
  assertEquals(out.map((o) => o.viewedAt), ["2026-11-17T10:00:00.000Z"]);
});

Deno.test("REQ-955 (LOOP-007 q1-30): a bucket is an hour from its first view, not a sliding window", () => {
  const out = mergeOpensByHour([
    v("2026-11-17T10:00:00.000Z"),
    v("2026-11-17T10:40:00.000Z"),
    v("2026-11-17T11:00:00.000Z"),
    v("2026-11-17T11:30:00.000Z"),
  ]);
  assertEquals(out.map((o) => o.viewedAt), [
    "2026-11-17T10:00:00.000Z",
    "2026-11-17T11:00:00.000Z",
  ]);
});

Deno.test("REQ-955 (LOOP-007 q1-30): no views, no opens", () => {
  assertEquals(mergeOpensByHour([]), []);
});
