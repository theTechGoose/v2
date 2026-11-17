/**
 * REQ-755 (demo-loop cycle 5v1, M15 re-test) — the verifier typed "door trim
 * for the gomezes is not 200, it's 275" on Q-002 (Door trim $200). The model
 * repriced the line AND filed a change order "Door trim" +$75, so the job
 * gained a second door trim line. REQ-661 only read "<item> is $X not <old>";
 * the old price FIRST ("is not 200, it's 275") was never a correction, so
 * nothing stopped the model's change order.
 */
import { assertEquals } from "#std/assert";
import { correctionForChange, parseLineCorrection } from "./mod.ts";

const VERIFIER = "door trim for the gomezes is not 200, it's 275";

Deno.test("REQ-755 M15 parseLineCorrection: the verifier's 'is not 200, it's 275' → Door trim, the Gomezes, $275 (was $200)", () => {
  assertEquals(parseLineCorrection(VERIFIER), {
    item: "door trim",
    customerName: "gomezes",
    amountCents: 27_500,
    previousCents: 20_000,
  });
});

Deno.test("REQ-755 M15 parseLineCorrection: old-price-first and bare-number forms, en + es", () => {
  assertEquals(parseLineCorrection("the door trim isn't $200, it's $275"), {
    item: "door trim",
    amountCents: 27_500,
    previousCents: 20_000,
  });
  assertEquals(
    parseLineCorrection("door trim is not 200 it should be 275"),
    { item: "door trim", amountCents: 27_500, previousCents: 20_000 },
  );
  assertEquals(parseLineCorrection("door trim is 275 not 200"), {
    item: "door trim",
    amountCents: 27_500,
    previousCents: 20_000,
  });
  assertEquals(
    parseLineCorrection("la moldura de puerta no es 200, es 275"),
    { item: "moldura de puerta", amountCents: 27_500, previousCents: 20_000 },
  );
});

Deno.test("REQ-755 M15 parseLineCorrection: a count or a size is not a price correction", () => {
  assertEquals(parseLineCorrection("the paint is 2 not 3 coats"), undefined);
  assertEquals(
    parseLineCorrection("the deck is not 200 sqft, it's 275 sqft"),
    undefined,
  );
  assertEquals(parseLineCorrection("it is not 200, it's 275"), undefined);
});

Deno.test("REQ-755 M15 correctionForChange: the model's 'Door trim' +$75 is the correction of that line; another item is not", () => {
  assertEquals(correctionForChange({ description: "Door trim" }, VERIFIER), {
    item: "door trim",
    customerName: "gomezes",
    amountCents: 27_500,
    previousCents: 20_000,
  });
  assertEquals(
    correctionForChange({ description: "Door trim adjustment" }, VERIFIER)
      ?.amountCents,
    27_500,
  );
  assertEquals(
    correctionForChange({ description: "Paint touch-up" }, VERIFIER),
    undefined,
  );
  assertEquals(
    correctionForChange({ description: "Door trim" }, "add door trim $75"),
    undefined,
  );
});
