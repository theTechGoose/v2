/**
 * REQ-661 (demo-loop cycle 5, M15) — "heated floor for the hendersons is
 * $1,200 not 150. add it as a change order please" became a line item named
 * "Heated floor for the hendersons is not 150" (+$1,200): the parser cut the
 * money out of a correction sentence and kept the rest as the item.
 *
 * A correction ("<item> is $X not <old>") names the item, the customer and
 * its RIGHT price — never a sentence as the description. Any clause that is
 * still a sentence (a copula, "not 150", "instead of") is the model's.
 */
import { assertEquals } from "#std/assert";
import {
  isCleanChangeClause,
  parseChangeOrderRequest,
  parseLineCorrection,
} from "./mod.ts";

const DEMO =
  "heated floor for the hendersons is $1,200 not 150. add it as a change order please";

Deno.test("REQ-661 M15 parseChangeOrderRequest: the demo's correction → Hendersons, 'Heated floor', $1,200, sets the line's price", () => {
  assertEquals(parseChangeOrderRequest(DEMO), {
    customerName: "hendersons",
    description: "Heated floor",
    deltaAmountCents: 120_000,
    setsLinePrice: true,
  });
});

Deno.test("REQ-661 M15 parseLineCorrection: '<item> is $X not <old>' in English and Spanish", () => {
  assertEquals(parseLineCorrection("the tile is $4,000 not $3,500"), {
    item: "tile",
    amountCents: 400_000,
    previousCents: 350_000,
  });
  assertEquals(
    parseLineCorrection("heated floor should be $1,200, not 150"),
    { item: "heated floor", amountCents: 120_000, previousCents: 15_000 },
  );
  assertEquals(
    parseLineCorrection("vanity is $900 instead of $700"),
    { item: "vanity", amountCents: 90_000, previousCents: 70_000 },
  );
  assertEquals(
    parseLineCorrection(
      "el piso radiante para los Henderson es $1,200, no 150",
    ),
    {
      item: "piso radiante",
      customerName: "Henderson",
      amountCents: 120_000,
      previousCents: 15_000,
    },
  );
  // no named line → not a line correction ("it", "the total")
  assertEquals(parseLineCorrection("it is $1,200 not 150"), undefined);
  assertEquals(
    parseLineCorrection("the total is $19,000 not 18,750"),
    undefined,
  );
  // not a correction at all
  assertEquals(parseLineCorrection("add a heated floor $1,200"), undefined);
});

Deno.test("REQ-661 M15 parseChangeOrderRequest: a correction after 'change order for X:' keeps X", () => {
  assertEquals(
    parseChangeOrderRequest(
      "Change order for Dana: the heated floor is $1,200 not $150",
    ),
    {
      customerName: "Dana",
      description: "Heated floor",
      deltaAmountCents: 120_000,
      setsLinePrice: true,
    },
  );
});

Deno.test("REQ-661 M15 isCleanChangeClause: a copula, 'not N' or 'instead of' makes it a sentence, not an item", () => {
  for (
    const bad of [
      "heated floor for the hendersons is not 150",
      "Heated floor is 1200",
      "tile not 150",
      "vanity instead of 700",
      "piso radiante es no 150",
      "piso radiante en vez de 150",
    ]
  ) assertEquals(isCleanChangeClause(bad), false, bad);
  for (
    const ok of [
      "Heated floor",
      "2 ceiling fans",
      "Credit for the missed visit",
      "Second coat of paint",
    ]
  ) assertEquals(isCleanChangeClause(ok), true, ok);
});

Deno.test("REQ-661 M15 parseChangeOrderRequest: a sentence left over after the money is never the description", () => {
  // the money is cut, the rest is still a correction sentence the parser
  // cannot read as one — hand it to the model (no description)
  const out = parseChangeOrderRequest(
    "change order: floor for the Smiths is really like $1,200 not 150",
  );
  assertEquals(out?.description, undefined);
});
