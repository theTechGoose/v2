import { assertEquals } from "#std/assert";
import { summarize } from "./mod.ts";

Deno.test("summarize: empty list reports zeros", () => {
  const s = summarize([]);
  assertEquals(s.total, 0);
  assertEquals(s.uniqueViewers, 0);
  assertEquals(s.firstViewedAt, null);
  assertEquals(s.lastViewedAt, null);
});

Deno.test("summarize: counts views and finds first/last by ISO order", () => {
  const s = summarize([
    { viewedAt: "2026-04-26T11:00:00Z", viewerId: "u1" },
    { viewedAt: "2026-04-26T10:00:00Z", viewerId: "u2" },
    { viewedAt: "2026-04-26T12:00:00Z", viewerId: "u1" },
  ]);
  assertEquals(s.total, 3);
  assertEquals(s.uniqueViewers, 2);
  assertEquals(s.firstViewedAt, "2026-04-26T10:00:00Z");
  assertEquals(s.lastViewedAt, "2026-04-26T12:00:00Z");
});

Deno.test("summarize: anonymous views (no viewerId/email) don't count toward unique viewers", () => {
  const s = summarize([
    { viewedAt: "2026-04-26T10:00:00Z" },
    { viewedAt: "2026-04-26T11:00:00Z" },
    { viewedAt: "2026-04-26T12:00:00Z", viewerEmail: "ops@acme.test" },
  ]);
  assertEquals(s.total, 3);
  assertEquals(s.uniqueViewers, 1);
});
