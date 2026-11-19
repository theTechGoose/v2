/**
 * REQ-926 — Raphael: "add to the payment a 'chargeback' button … a modal
 * when the chargeback is clicked to add a fee." The fee joins the reopened
 * invoice as its own untaxed line, and comes off again on undo.
 */
import { assertEquals, assertNotEquals } from "#std/assert";
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

/*
 * REQ-1124 (LOOP-007 q3, q3-52) — an amount-only invoice with no job name and
 * no description must not gain a made-up English "Services" line: the /i hero
 * (REQ-984: job, else first line, else "Invoice INV-001") would then read
 * "Services", in English, on a Spanish bill too. The base line is honest,
 * in the invoice's language, tagged as the chargeback's own, and Undo takes
 * it off with the fee so the invoice is amount-only again.
 */
for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-1124 (q3-52) withChargebackFee: a bare amount-only invoice (${lang}) gets no made-up "Services" line — the base line is localized and tagged for the payment`, () => {
    const patch = withChargebackFee(
      { amount: 100050, lang },
      "pay-3",
      3500,
    );
    assertEquals(patch.amount, 103550);
    const base = patch.lineItems[0];
    assertEquals(patch.lineItems.length, 2);
    assertEquals(base.price, 100050);
    assertNotEquals(
      base.description,
      "Services",
      `the base line is the made-up English placeholder "Services" (${lang})`,
    );
    assertEquals(
      base.chargebackBase,
      "pay-3",
      "the made-up base line is tagged as the chargeback's own (chargebackBase)",
    );
    if (lang === "es") {
      const en = withChargebackFee({ amount: 100050 }, "pay-3", 3500);
      assertNotEquals(
        base.description,
        en.lineItems[0].description,
        "the Spanish base line is in Spanish, not the English text",
      );
    }
  });
}

Deno.test("REQ-1124 (q3-52) withoutChargebackFee: undoing the only chargeback on a bare amount-only invoice gives back NO lines, not a leftover made-up base line", () => {
  const added = withChargebackFee({ amount: 100050 }, "pay-3", 3500);
  const removed = withoutChargebackFee(
    { ...added, lineItems: added.lineItems },
    "pay-3",
  )!;
  assertEquals(removed.lineItems, [], "the invoice is amount-only again");
  assertEquals(removed.amount, 100050);
});
