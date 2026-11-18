/**
 * REQ-926 — Raphael: "add to the payment a 'chargeback' button … a modal
 * when the chargeback is clicked to add a fee." The fee joins the reopened
 * invoice as its own untaxed line, and comes off again on undo.
 */
import { assertEquals } from "#std/assert";
import {
  CHARGEBACK_FEE_LABEL,
  withChargebackFee,
  withoutChargebackFee,
} from "./mod.ts";

const LINES = [
  { description: "Mow", quantity: 2, unit: "visit", price: 5000 },
];

Deno.test("REQ-926 withChargebackFee: a fee line, flagged for the payment, in the invoice's language; subtotal and amount rise by the fee; tax is untouched", () => {
  const patch = withChargebackFee(
    {
      lineItems: LINES,
      subtotalCents: 10000,
      taxCents: 825,
      amount: 10825,
      lang: "es",
    },
    "pay-1",
    3500,
  );
  assertEquals(patch.lineItems, [
    ...LINES,
    {
      description: CHARGEBACK_FEE_LABEL.es,
      quantity: 1,
      unit: "ea",
      price: 3500,
      chargebackFor: "pay-1",
    },
  ]);
  assertEquals([patch.subtotalCents, patch.amount], [13500, 14325]);
  assertEquals("taxCents" in patch, false);
});

Deno.test("REQ-926 withChargebackFee: an amount-only invoice first gets its amount as one line; English by default; no subtotal stays none", () => {
  const patch = withChargebackFee(
    { amount: 40000, jobName: "Fence stain" },
    "pay-2",
    2500,
  );
  assertEquals(patch.lineItems, [
    { description: "Fence stain", quantity: 1, unit: "ea", price: 40000 },
    {
      description: "Chargeback fee",
      quantity: 1,
      unit: "ea",
      price: 2500,
      chargebackFor: "pay-2",
    },
  ]);
  assertEquals(patch.amount, 42500);
  assertEquals("subtotalCents" in patch, false);
});

Deno.test("REQ-926 withoutChargebackFee: takes that payment's fee line off and lowers subtotal and amount; nothing to take → null", () => {
  const added = withChargebackFee(
    { lineItems: LINES, subtotalCents: 10000, amount: 10000 },
    "pay-1",
    3500,
  );
  const removed = withoutChargebackFee(added, "pay-1")!;
  assertEquals(removed.lineItems, LINES);
  assertEquals([removed.subtotalCents, removed.amount], [10000, 10000]);
  assertEquals(withoutChargebackFee(added, "pay-other"), null);
  assertEquals(withoutChargebackFee({ amount: 5 }, "pay-1"), null);
});
