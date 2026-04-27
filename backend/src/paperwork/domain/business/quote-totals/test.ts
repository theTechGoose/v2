import { assertEquals } from "#std/assert";
import { quoteTotal } from "./mod.ts";

Deno.test("quoteTotal: empty list is 0", () => {
  assertEquals(quoteTotal([]), 0);
});

Deno.test("quoteTotal: sums quantity * price across line items", () => {
  assertEquals(
    quoteTotal([
      { description: "tank", quantity: 1, unit: "ea", price: 800 },
      { description: "labor", quantity: 4, unit: "hr", price: 120 },
    ]),
    1280,
  );
});
