import { assertEquals } from "#std/assert";
import {
  entryDirection,
  hasCredit,
  isOutstanding,
  isSettled,
} from "./mod.ts";

Deno.test("entryDirection: negative amounts are charges", () => {
  assertEquals(entryDirection({ amount: -1280 }), "charge");
});

Deno.test("entryDirection: positive amounts are payments", () => {
  assertEquals(entryDirection({ amount: 1280 }), "payment");
});

Deno.test("entryDirection: zero is a noop", () => {
  assertEquals(entryDirection({ amount: 0 }), "noop");
});

Deno.test("standing helpers: outstanding/settled/credit", () => {
  assertEquals(isOutstanding(-100), true);
  assertEquals(isSettled(0), true);
  assertEquals(hasCredit(50), true);
  assertEquals(isOutstanding(0), false);
});
