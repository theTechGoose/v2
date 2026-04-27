import { assertEquals } from "#std/assert";
import { direction, isPostable } from "./mod.ts";

Deno.test("isPostable: rejects missing accountId", () => {
  assertEquals(isPostable({ accountId: "", amount: 100, occurredAt: "2026-04-26" }), false);
});

Deno.test("isPostable: rejects zero amount", () => {
  assertEquals(isPostable({ accountId: "a", amount: 0, occurredAt: "2026-04-26" }), false);
});

Deno.test("isPostable: rejects unparseable date", () => {
  assertEquals(isPostable({ accountId: "a", amount: 1, occurredAt: "not-a-date" }), false);
});

Deno.test("isPostable: accepts well-formed entry", () => {
  assertEquals(isPostable({ accountId: "a", amount: -50, occurredAt: "2026-04-26" }), true);
});

Deno.test("direction: positive=debit, negative=credit, zero=zero", () => {
  assertEquals(direction({ amount: 1 }), "debit");
  assertEquals(direction({ amount: -1 }), "credit");
  assertEquals(direction({ amount: 0 }), "zero");
});
