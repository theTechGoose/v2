import { assertEquals } from "#std/assert";
import { deriveMood } from "./mod.ts";

const NOW = new Date(Date.UTC(2026, 3, 15)); // Apr 15, 2026

Deno.test("contract-mood: unsigned recently touched → draft", () => {
  assertEquals(
    deriveMood({ status: "draft", updatedAt: "2026-04-10T00:00:00Z" }, NOW),
    "draft",
  );
});

Deno.test("contract-mood: unsigned + idle >30 days → stale", () => {
  assertEquals(
    deriveMood({ status: "draft", updatedAt: "2026-02-01T00:00:00Z" }, NOW),
    "stale",
  );
});

Deno.test("contract-mood: signed + startDate within 7 days → starting-soon", () => {
  assertEquals(
    deriveMood({
      status: "signed",
      signedAt: "2026-04-01T00:00:00Z",
      startDate: "2026-04-20",
      updatedAt: "2026-04-01T00:00:00Z",
    }, NOW),
    "starting-soon",
  );
});

Deno.test("contract-mood: signed + completion within 7 days → wrapping-up", () => {
  assertEquals(
    deriveMood({
      status: "signed",
      signedAt: "2026-03-01T00:00:00Z",
      startDate: "2026-03-10",
      estimatedCompletionDate: "2026-04-20",
      updatedAt: "2026-03-01T00:00:00Z",
    }, NOW),
    "wrapping-up",
  );
});

Deno.test("contract-mood: signed + completion in the past → completed", () => {
  assertEquals(
    deriveMood({
      status: "signed",
      signedAt: "2026-01-01T00:00:00Z",
      estimatedCompletionDate: "2026-04-01",
      updatedAt: "2026-01-01T00:00:00Z",
    }, NOW),
    "completed",
  );
});

Deno.test("contract-mood: signed mid-flight → active", () => {
  assertEquals(
    deriveMood({
      status: "signed",
      signedAt: "2026-03-01T00:00:00Z",
      startDate: "2026-03-10",
      estimatedCompletionDate: "2026-06-01",
      updatedAt: "2026-03-01T00:00:00Z",
    }, NOW),
    "active",
  );
});
