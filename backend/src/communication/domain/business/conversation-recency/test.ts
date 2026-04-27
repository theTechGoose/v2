import { assertEquals } from "#std/assert";
import { isStale } from "./mod.ts";

const now = new Date("2026-05-01T00:00:00Z");

Deno.test("isStale: false when updated within window", () => {
  assertEquals(isStale({ updatedAt: "2026-04-29T00:00:00Z" }, now, 7), false);
});

Deno.test("isStale: true when updated past window", () => {
  assertEquals(isStale({ updatedAt: "2026-04-01T00:00:00Z" }, now, 7), true);
});

Deno.test("isStale: true when updatedAt missing", () => {
  assertEquals(isStale({}, now, 7), true);
});
