import { assertEquals } from "#std/assert";
import { relativeTime } from "./mod.ts";

const NOW = new Date("2026-04-28T12:00:00.000Z");

Deno.test("relativeTime: null/undefined → never", () => {
  assertEquals(relativeTime(null, NOW), "never");
  assertEquals(relativeTime(undefined, NOW), "never");
});

Deno.test("relativeTime: future timestamp clamps to just now", () => {
  assertEquals(relativeTime("2027-01-01T00:00:00.000Z", NOW), "just now");
});

Deno.test("relativeTime: < 1 minute → just now", () => {
  assertEquals(relativeTime("2026-04-28T11:59:30.000Z", NOW), "just now");
});

Deno.test("relativeTime: minutes", () => {
  assertEquals(relativeTime("2026-04-28T11:55:00.000Z", NOW), "5m ago");
});

Deno.test("relativeTime: hours", () => {
  assertEquals(relativeTime("2026-04-28T10:00:00.000Z", NOW), "2h ago");
});

Deno.test("relativeTime: 1 day", () => {
  assertEquals(relativeTime("2026-04-27T11:00:00.000Z", NOW), "1 day ago");
});

Deno.test("relativeTime: N days", () => {
  assertEquals(relativeTime("2026-04-25T12:00:00.000Z", NOW), "3 days ago");
});

Deno.test("relativeTime: weeks", () => {
  assertEquals(relativeTime("2026-04-14T12:00:00.000Z", NOW), "2 weeks ago");
});

Deno.test("relativeTime: months", () => {
  assertEquals(relativeTime("2026-01-28T12:00:00.000Z", NOW), "3 months ago");
});

Deno.test("relativeTime: years", () => {
  assertEquals(relativeTime("2024-04-28T12:00:00.000Z", NOW), "2 years ago");
});
