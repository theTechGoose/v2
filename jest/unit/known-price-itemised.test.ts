/**
 * REQ-259 (demo issue M23) — "I know my price" took $8,000 instead of the
 * $14,700 total and dropped the line prices.
 *
 * The demo typed an itemised sentence into the "I know my price, write it up."
 * starter: "…: demo $2,500, cabinets $8,000, quartz countertops $4,200".
 * extractPriceCents (shared/quote-flow/quick-quote-prefill.ts) kept only the
 * LARGEST amount (a rule written for "deposit vs. total"), so the price picker
 * opened at $8,000; and startQuoteFromRaw (front-end/islands/AsstChat.tsx)
 * always wrote ONE summary line, so the three priced lines could never survive.
 *
 * This file pins: an itemised list sums to its total, an explicit total or a
 * deposit is still told apart, the priced lines are extracted with their
 * labels, and the island builds the quote's line items from them.
 *
 * Phones used: none (pure unit).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import * as fs from "fs";
import * as path from "path";

const M23_SENTENCE =
  "Kitchen remodel for Maria Lopez, 512-555-0199, 12 Oak St Austin: demo $2,500, cabinets $8,000, quartz countertops $4,200";

describe("REQ-259 extractPriceCents — itemised amounts vs. total + deposit", () => {
  let mod: any;
  beforeAll(() => {
    mod = require("../../shared/quote-flow/quick-quote-prefill");
  });

  it("REQ-259 M23: the demo's itemised sentence → the SUM $14,700, not the largest line", () => {
    expect(mod.extractPriceCents(M23_SENTENCE)).toBe(1470000);
  });

  it("REQ-259 '$2,500, $8,000, $4,200' (no labels) → 1470000", () => {
    expect(mod.extractPriceCents("Kitchen: $2,500, $8,000, $4,200")).toBe(
      1470000,
    );
  });

  it("REQ-259 '$3,700, $1,000 deposit' → the total 370000 (deposit not added)", () => {
    expect(mod.extractPriceCents("New fence $3,700, $1,000 deposit")).toBe(
      370000,
    );
  });

  it("REQ-259 an explicit 'total $X' wins over the items", () => {
    expect(
      mod.extractPriceCents(
        "Bathroom: tile $1,200, vanity $800, total $2,500 with fixtures",
      ),
    ).toBe(250000);
  });

  it("REQ-259 ES 'anticipo' is a deposit: '$500 de anticipo, $3,700 en total' → 370000", () => {
    expect(
      mod.extractPriceCents("Patio nuevo — $500 de anticipo, $3,700 en total"),
    ).toBe(370000);
  });

  it("REQ-259 '$1,000 down' and '30% deposit' are deposits", () => {
    expect(mod.extractPriceCents("Roof $9,000 with $1,000 down")).toBe(900000);
    expect(mod.extractPriceCents("Deck $6,000, 30% deposit $1,800")).toBe(
      600000,
    );
  });

  it("REQ-259 '$3700 dollars' is ONE amount, never counted twice", () => {
    expect(mod.extractPriceCents("Cambio de techo $3700 dollars")).toBe(370000);
  });

  it("REQ-259 a single amount is unchanged", () => {
    expect(mod.extractPriceCents("Cerca nueva, 3700 dólares todo incluido"))
      .toBe(370000);
  });
});

describe("REQ-259 extractPriceLines — the priced lines the user typed", () => {
  let mod: any;
  beforeAll(() => {
    mod = require("../../shared/quote-flow/quick-quote-prefill");
  });

  it("REQ-259 M23: three labelled lines, in order, with their cents", () => {
    expect(mod.extractPriceLines(M23_SENTENCE)).toEqual([
      { label: "Demo", cents: 250000 },
      { label: "Cabinets", cents: 800000 },
      { label: "Quartz countertops", cents: 420000 },
    ]);
  });

  it("REQ-259 a label AFTER the amount ('$2,500 demo, $8,000 cabinets') is used", () => {
    expect(mod.extractPriceLines("Kitchen: $2,500 demo, $8,000 cabinets"))
      .toEqual([
        { label: "Demo", cents: 250000 },
        { label: "Cabinets", cents: 800000 },
      ]);
  });

  it("REQ-259 newline-separated items", () => {
    expect(
      mod.extractPriceLines("Bathroom\n- Tile: $1,200\n- Vanity: $800"),
    ).toEqual([
      { label: "Tile", cents: 120000 },
      { label: "Vanity", cents: 80000 },
    ]);
  });

  it("REQ-259 no lines for a single amount, a total+deposit, or unlabelled amounts", () => {
    expect(mod.extractPriceLines("Cambio de techo $3700")).toEqual([]);
    expect(mod.extractPriceLines("New fence $3,700, $1,000 deposit"))
      .toEqual([]);
    expect(mod.extractPriceLines("Kitchen: $2,500, $8,000, $4,200"))
      .toEqual([]);
  });

  it("REQ-259 extractQuickQuotePrefill carries the lines and the summed price", () => {
    const p = mod.extractQuickQuotePrefill(M23_SENTENCE);
    expect(p.priceCents).toBe(1470000);
    expect(p.customerName).toBe("Maria Lopez");
    expect(p.lines).toHaveLength(3);
  });
});

describe("REQ-259 quoteLineItemsFromPrefill — the quote keeps the typed lines", () => {
  let mod: any;
  beforeAll(() => {
    mod = require("../../shared/quote-flow/quick-quote-prefill");
  });

  const lines = [
    { label: "Demo", cents: 250000 },
    { label: "Cabinets", cents: 800000 },
    { label: "Quartz countertops", cents: 420000 },
  ];

  it("REQ-259 lines that add up to the confirmed price become the quote's lines", () => {
    expect(
      mod.quoteLineItemsFromPrefill(lines, 1470000, "Kitchen remodel"),
    ).toEqual([
      { description: "Demo", quantity: 1, unit: "ea", price: 250000 },
      { description: "Cabinets", quantity: 1, unit: "ea", price: 800000 },
      {
        description: "Quartz countertops",
        quantity: 1,
        unit: "ea",
        price: 420000,
      },
    ]);
  });

  it("REQ-259 a price the user changed on the picker → one summary line at that price", () => {
    expect(
      mod.quoteLineItemsFromPrefill(lines, 1500000, "Kitchen remodel"),
    ).toEqual([
      {
        description: "Kitchen remodel",
        quantity: 1,
        unit: "ea",
        price: 1500000,
      },
    ]);
  });

  it("REQ-259 no lines → one summary line (the old behaviour)", () => {
    expect(mod.quoteLineItemsFromPrefill([], 370000, "Fence")).toEqual([
      { description: "Fence", quantity: 1, unit: "ea", price: 370000 },
    ]);
  });
});

describe("REQ-259 AsstChat wiring — the known-price flow keeps the lines", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../../front-end/islands/AsstChat.tsx"),
    "utf8",
  );

  it("REQ-259 submitJobDetails stores the extracted lines", () => {
    const body = src.slice(
      src.indexOf("function submitJobDetails("),
      src.indexOf("function openWriteMyself("),
    );
    expect(body).toMatch(/setPrefillLines\(prefill\.lines\)/);
  });

  it("REQ-259 startQuoteFromRaw builds lineItems from the prefill lines", () => {
    const body = src.slice(
      src.indexOf("async function startQuoteFromRaw("),
      src.indexOf("function submitJobDetails("),
    );
    expect(body).toMatch(
      // REQ-579 (cycle 4, M14): the single line is the job's name
      // (quickQuoteNames().line), never the raw 8-word summary slice.
      /lineItems:\s*quoteLineItemsFromPrefill\(\s*prefillLines,\s*cents,\s*names\.line,?\s*\)/,
    );
  });

  it("REQ-259 the end-of-phase-2 picker renames only a lone summary line, never itemised lines", () => {
    // applyJobOption used to overwrite line 0's description with the picked
    // summary — on an itemised quote that erased "Demo".
    expect(src).toMatch(
      /quote\?\.lineItems\?\.length === 1\s*\n?\s*\?\s*\[\{\s*\.\.\.quote\.lineItems\[0\],\s*description:\s*summary\s*\}\]/,
    );
  });
});

/**
 * REQ-952 (LOOP-007 cycle 1, QA issue q1-29) — the assistant merged labor and
 * materials into one line. The tester typed "…Mano de obra $1,800, materiales
 * $600. Total $2,400" and the quote got ONE $2,400 line: extractPriceLines
 * returned [] as soon as any amount carried a total word, without checking
 * that the labelled amounts add up to that total.
 */
const Q1_29_SENTENCE =
  "Instalación de piso de azulejo en baño, 60 pies cuadrados, para Ana López. Mano de obra $1,800, materiales $600. Total $2,400";

describe("REQ-952 (q1-29) a typed itemisation plus its matching total keeps the lines", () => {
  let mod: any;
  beforeAll(() => {
    mod = require("../../shared/quote-flow/quick-quote-prefill");
  });

  it("REQ-952 q1-29: the tester's Spanish sentence → Mano de obra $1,800 + Materiales $600, price $2,400", () => {
    expect(mod.extractPriceCents(Q1_29_SENTENCE)).toBe(240000);
    expect(mod.extractPriceLines(Q1_29_SENTENCE)).toEqual([
      { label: "Mano de obra", cents: 180000 },
      { label: "Materiales", cents: 60000 },
    ]);
  });

  it("REQ-952 q1-29: the quote built from the tester's sentence carries two lines, not one $2,400 line", () => {
    const p = mod.extractQuickQuotePrefill(Q1_29_SENTENCE);
    expect(p.priceCents).toBe(240000);
    const items = mod.quoteLineItemsFromPrefill(
      p.lines,
      p.priceCents,
      "Instalación de piso",
    );
    expect(items.map((i: any) => [i.description, i.price])).toEqual([
      ["Mano de obra", 180000],
      ["Materiales", 60000],
    ]);
  });

  it("REQ-952 'labor $1,800, materials $600, total $2,400' → two lines", () => {
    const s = "labor $1,800, materials $600, total $2,400";
    expect(mod.extractPriceCents(s)).toBe(240000);
    expect(mod.extractPriceLines(s)).toEqual([
      { label: "Labor", cents: 180000 },
      { label: "Materials", cents: 60000 },
    ]);
  });

  it("REQ-952 '…$1,800, materiales $600, $2,400 en total' (total word after) → two lines", () => {
    const s = "Mano de obra $1,800, materiales $600, $2,400 en total";
    expect(mod.extractPriceLines(s)).toEqual([
      { label: "Mano de obra", cents: 180000 },
      { label: "Materiales", cents: 60000 },
    ]);
  });

  it("REQ-952 a total that does NOT match the lines → no lines, the total is the price", () => {
    const s = "labor $1,800, materials $600, total $2,500";
    expect(mod.extractPriceCents(s)).toBe(250000);
    expect(mod.extractPriceLines(s)).toEqual([]);
    expect(
      mod.extractPriceLines(
        "Bathroom: tile $1,200, vanity $800, total $2,500 with fixtures",
      ),
    ).toEqual([]);
  });

  it("REQ-952 deposits still give no lines, even next to a matching total", () => {
    expect(mod.extractPriceLines("New fence $3,700, $1,000 deposit"))
      .toEqual([]);
    expect(
      mod.extractPriceLines("Patio nuevo — $500 de anticipo, $3,700 en total"),
    ).toEqual([]);
    expect(
      mod.extractPriceLines(
        "labor $1,800, materials $600, total $2,400, $500 deposit",
      ),
    ).toEqual([]);
  });

  it("REQ-952 a lone total with one other amount is not a list", () => {
    expect(mod.extractPriceLines("Roof $2,400, total $2,400")).toEqual([]);
  });
});
