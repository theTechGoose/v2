import { assertEquals } from "#std/assert";
import { isSendable } from "./mod.ts";

Deno.test("isSendable: false when summary blank", () => {
  assertEquals(isSendable({ summary: "  ", lineItems: [{ description: "x", quantity: 1, unit: "ea", price: 10 }] }), false);
});

Deno.test("isSendable: false when no line items", () => {
  assertEquals(isSendable({ summary: "Job", lineItems: [] }), false);
});

Deno.test("isSendable: false when any line has quantity 0", () => {
  assertEquals(
    isSendable({ summary: "Job", lineItems: [{ description: "x", quantity: 0, unit: "ea", price: 10 }] }),
    false,
  );
});

Deno.test("isSendable: true with summary + valid line items", () => {
  assertEquals(
    isSendable({ summary: "Job", lineItems: [{ description: "x", quantity: 2, unit: "ea", price: 10 }] }),
    true,
  );
});
