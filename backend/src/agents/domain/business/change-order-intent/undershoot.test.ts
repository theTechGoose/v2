/**
 * REQ-651 (demo-loop cycle 5, B1) — "about 1200 extra" is $1,200.
 *
 * Pair 7 typed "also add change order for the Hendersons: heated floor in
 * bath, 64 sqft, about 1200 extra…" on a sent $18,750 quote; the model's
 * change_order carried 15000 ($150) and it was written to the pending
 * revision (fleet-6 stdout:331). typedAmountsCents knew only "$N", so
 * reconcileChangeOrderDelta had nothing to check the $150 against.
 */
import { assertEquals } from "#std/assert";
import { changeOrderAmountsCents, reconcileChangeOrderDelta } from "./mod.ts";

const PAIR7_TEXT =
  "also add change order for the Hendersons: heated floor in bath, 64 sqft, about 1200 extra. oh and its NOT done before thanksgiving…fix that";

Deno.test("REQ-651 B1 changeOrderAmountsCents: a bare amount next to a money cue is money — never a size", () => {
  assertEquals(changeOrderAmountsCents(PAIR7_TEXT), [120_000]);
  assertEquals(changeOrderAmountsCents("1200 more for the heated floor"), [
    120_000,
  ]);
  assertEquals(changeOrderAmountsCents("add an additional 1,200"), [120_000]);
  assertEquals(changeOrderAmountsCents("heated floor, $1.2k"), [120_000]);
  assertEquals(changeOrderAmountsCents("heated floor, add $1,200"), [
    120_000,
  ]);
  assertEquals(
    changeOrderAmountsCents(
      "Maria also wants the oven done, add 60 to her job",
    ),
    [6_000],
  );
  // sizes, counts and rates are not the change's amount
  assertEquals(changeOrderAmountsCents("heated floor, 64 sqft"), []);
  assertEquals(changeOrderAmountsCents("add 2 more outlets"), []);
  assertEquals(changeOrderAmountsCents("add 20 ft more fence"), []);
  assertEquals(changeOrderAmountsCents("10 ft extra at $55 a foot"), []);
});

Deno.test("REQ-651 B1 reconcileChangeOrderDelta: pair 7's $150 for 'about 1200 extra' is never written — asked about", () => {
  assertEquals(
    reconcileChangeOrderDelta({
      deltaCents: 15_000,
      userText: PAIR7_TEXT,
      bases: [1_875_000],
    }),
    { kind: "ask" },
  );
});

Deno.test("REQ-651 B1 reconcileChangeOrderDelta: the model's ×10 slip of 'about 1200 extra' is corrected; the right amount stands", () => {
  assertEquals(
    reconcileChangeOrderDelta({
      deltaCents: 12_000,
      userText: PAIR7_TEXT,
      bases: [1_875_000],
    }),
    { kind: "ok", deltaCents: 120_000 },
  );
  assertEquals(
    reconcileChangeOrderDelta({
      deltaCents: 120_000,
      userText: PAIR7_TEXT,
      bases: [1_875_000],
    }),
    { kind: "ok", deltaCents: 120_000 },
  );
});
