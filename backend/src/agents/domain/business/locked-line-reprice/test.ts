/**
 * REQ-767 (demo-loop cycle 5v2, m43 re-test) — the verifier's two asks the
 * REQ-664 offer missed, read in code: "lower the line to $300" (the model
 * answered in text, no tool) and "the sink repair line should be $400
 * instead of $350" on a quote whose only line is Spanish.
 */
import { assertEquals } from "#std/assert";
import { parseLineRepriceAsk, pickRepriceLine } from "./mod.ts";

Deno.test("REQ-767 m43: the verifier's three asks are read as a line's new price", () => {
  assertEquals(
    parseLineRepriceAsk(
      "Change the price on Q-001 for Carmen to $425 — the faucet she picked costs more.",
    ),
    {
      phrase: "the price on Q-001 for Carmen",
      amountCents: 42_500,
      quoteNumber: "Q-001",
    },
  );
  assertEquals(
    parseLineRepriceAsk(
      "On Q-001, lower the line to $300 — I'm giving Carmen a discount.",
    ),
    { phrase: "the line", amountCents: 30_000, quoteNumber: "Q-001" },
  );
  assertEquals(
    parseLineRepriceAsk(
      "Update Carmen Núñez's plumbing quote Q-001: the sink repair line should be $400 instead of $350.",
    ),
    {
      phrase:
        "Update Carmen Núñez's plumbing quote Q-001: the sink repair line",
      amountCents: 40_000,
      quoteNumber: "Q-001",
    },
  );
  assertEquals(
    parseLineRepriceAsk("baja la reparación a $1,250.50"),
    { phrase: "la reparación", amountCents: 125_050 },
  );
});

Deno.test("REQ-767 m43: billing, change-order, deposit and amount-less asks are not a line's new price", () => {
  for (
    const text of [
      "change the deposit to $300",
      "add a change order for $300 to Q-001",
      "edit CO-001 to $300",
      "lower INV-001 to $300",
      "mark the invoice paid, $300",
      "what should the sink repair cost?",
      "change the start date to Monday",
      "change Q-001 to 30%",
    ]
  ) {
    assertEquals(parseLineRepriceAsk(text), undefined, text);
  }
});

const sink = {
  description:
    "Reparar fuga debajo del fregadero (incluye cambiar llave del fregadero)",
};

Deno.test("REQ-767 m43: a quote's only line is the one a reprice means, whatever it is called", () => {
  assertEquals(pickRepriceLine([sink], "the line"), 0);
  assertEquals(pickRepriceLine([sink], "sink repair"), 0);
  assertEquals(
    pickRepriceLine(
      [sink],
      "Update Carmen Núñez's plumbing quote Q-001: the sink repair line",
    ),
    0,
  );
});

Deno.test("REQ-767 m43: on several lines the named one wins — through its translation too; an unnamed or unknown line is no pick", () => {
  const lines = [
    { description: "Demolición", descriptionByLang: { en: "Demolition" } },
    {
      ...sink,
      descriptionByLang: {
        en: "Repair leak under the sink (includes replacing the faucet)",
      },
    },
  ];
  assertEquals(pickRepriceLine(lines, "the sink repair line"), 1);
  assertEquals(pickRepriceLine(lines, "fregadero"), 1);
  assertEquals(pickRepriceLine(lines, "demolition"), 0);
  assertEquals(pickRepriceLine(lines, "the line"), -1);
  assertEquals(pickRepriceLine(lines, "the cabinets"), -1);
});
