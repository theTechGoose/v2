import { assertEquals } from "#std/assert";
import { balanceDue } from "./mod.ts";

Deno.test("balanceDue: amount minus payments", () => {
  assertEquals(balanceDue({ amount: 1000 }, 250), 750);
});

Deno.test("balanceDue: zero when payments exceed amount", () => {
  assertEquals(balanceDue({ amount: 100 }, 250), 0);
});

Deno.test("balanceDue: treats missing amount as 0", () => {
  assertEquals(balanceDue({}, 50), 0);
});
