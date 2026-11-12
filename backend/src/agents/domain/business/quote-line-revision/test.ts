/**
 * REQ-315 (demo-loop cycle 1, M26) — "change plumbing fixtures to $1,300" must
 * change THAT line. The demo got a fifth line "Adjust plumbing fixtures to
 * $1,300 ($150.00)" because the only operation the assistant had appended.
 * These are the pure rules: finding the line the user named, and building the
 * revised line items.
 */
import { assertEquals } from "#std/assert";
import {
  changeOrderAsReprice,
  findLine,
  lineKey,
  parseLineReprice,
  type RevisableLine,
  reviseLineItems,
} from "./mod.ts";

/** Dana's bathroom remodel as the demo quoted it: $9,500 over four lines. */
const DANA = [
  { description: "Demo and disposal", quantity: 1, unit: "ea", price: 120_000 },
  { description: "Plumbing fixtures", quantity: 1, unit: "ea", price: 115_000 },
  {
    description: "Tile floor and walls",
    quantity: 1,
    unit: "ea",
    price: 480_000,
  },
  {
    description: "Vanity and lighting",
    quantity: 1,
    unit: "ea",
    price: 235_000,
  },
];

Deno.test("REQ-315 M26 reviseLineItems: 'plumbing fixtures → $1,300' reprices THAT line — still four lines, $9,500 → $9,650", () => {
  const out = reviseLineItems(
    DANA,
    [{ match: "plumbing fixtures", amountCents: 130_000 }],
    [],
  );
  assertEquals(out.unmatched, []);
  assertEquals(out.lineItems.length, 4);
  assertEquals(out.lineItems[1], {
    description: "Plumbing fixtures",
    quantity: 1,
    unit: "ea",
    price: 130_000,
  });
  assertEquals(
    out.lineItems.map((l) => l.description),
    DANA.map((l) => l.description),
  );
  assertEquals(out.estimatedTotal, 965_000);
  // the input is not mutated
  assertEquals(DANA[1].price, 115_000);
});

Deno.test("REQ-315 lineKey / findLine: exact, then case / space / punctuation-insensitive, then containment, then every word", () => {
  assertEquals(lineKey("  Plumbing — Fixtures! "), "plumbing fixtures");
  assertEquals(findLine(DANA, "Plumbing fixtures"), 1);
  assertEquals(findLine(DANA, "  PLUMBING   fixtures. "), 1);
  assertEquals(findLine(DANA, "plumbing"), 1); // the line contains the name
  assertEquals(findLine(DANA, "the plumbing fixtures line"), 1); // the name contains the line
  assertEquals(findLine(DANA, "fixtures plumbing"), 1); // every word, any order
  assertEquals(findLine(DANA, "tile walls"), 2);
  assertEquals(findLine(DANA, "vanities"), 3); // plural tolerance
  assertEquals(findLine(DANA, "roof"), -1);
  assertEquals(findLine(DANA, ""), -1);
});

Deno.test("REQ-315 reviseLineItems: a rewording keeps the price and drops the line's cached translations; a repriced qty>1 line becomes one flat amount", () => {
  const base: RevisableLine[] = [{
    description: "Paint",
    quantity: 4,
    unit: "gal",
    price: 5_000,
    descriptionByLang: { es: "Pintura" },
  }];
  const reworded = reviseLineItems(
    base,
    [{ match: "paint", description: "Paint, supplied by contractor" }],
    [],
  );
  assertEquals(reworded.lineItems, [{
    description: "Paint, supplied by contractor",
    quantity: 4,
    unit: "gal",
    price: 5_000,
  }]);
  assertEquals(reworded.estimatedTotal, 20_000);
  const repriced = reviseLineItems(base, [{
    match: "paint",
    amountCents: 24_000,
  }], []);
  assertEquals(repriced.lineItems, [{
    description: "Paint",
    quantity: 1,
    unit: "gal",
    price: 24_000,
    descriptionByLang: { es: "Pintura" },
  }]);
  assertEquals(repriced.estimatedTotal, 24_000);
});

Deno.test("REQ-315 reviseLineItems: removes the named lines and keeps the rest in order", () => {
  const out = reviseLineItems(DANA, [], ["vanity"]);
  assertEquals(out.lineItems.map((l) => l.description), [
    "Demo and disposal",
    "Plumbing fixtures",
    "Tile floor and walls",
  ]);
  assertEquals(out.estimatedTotal, 715_000);
  assertEquals(out.unmatched, []);
});

Deno.test("REQ-315 reviseLineItems: a name that matches nothing is reported and NOTHING is applied — never a guess, never a new line", () => {
  const out = reviseLineItems(
    DANA,
    [
      { match: "heated floor", amountCents: 120_000 },
      { match: "plumbing", amountCents: 130_000 },
    ],
    ["sauna"],
  );
  assertEquals(out.unmatched, ["heated floor", "sauna"]);
  assertEquals(out.lineItems, DANA);
  assertEquals(out.estimatedTotal, 950_000);
});

// ---------------------------------------------------------------------------
// REQ-315 M26 — reading a reprice out of plain words. The demo's model turned
// "Change plumbing fixtures to $1,300 on the quote I already sent (Q-001)"
// into change_order "Adjust plumbing fixtures to $1,300" (+$150), and a
// "change order for Dana on Q-001: change plumbing fixtures to $1,300" never
// reached the model at all — the change-order parser appended "Change
// plumbing fixtures to" for +$1,300. Both are a reprice of the named line.
// ---------------------------------------------------------------------------

Deno.test("REQ-315 M26 parseLineReprice: the demo's words — and the demo model's change-order description — name the line and its NEW total", () => {
  assertEquals(
    parseLineReprice(
      "Change plumbing fixtures to $1,300 on the quote I already sent (Q-001) and send her the new version.",
    ),
    { match: "plumbing fixtures", amountCents: 130_000 },
  );
  assertEquals(parseLineReprice("Adjust plumbing fixtures to $1,300"), {
    match: "plumbing fixtures",
    amountCents: 130_000,
  });
  assertEquals(parseLineReprice("change plumbing fixtures to $1,300"), {
    match: "plumbing fixtures",
    amountCents: 130_000,
  });
});

Deno.test("REQ-315 parseLineReprice: other ways to say it — make / set / bump / the price of / should be / X to $N / Spanish", () => {
  const cases: [string, string, number][] = [
    ["make the deck stain $400", "deck stain", 40_000],
    ["set the tile to $4,950.50", "tile", 495_050],
    ["bump the labor line to $2,100", "labor", 210_000],
    ["can you change the price of the vanity to $2,500?", "vanity", 250_000],
    ["change the plumbing price to $1,300", "plumbing", 130_000],
    [
      "change plumbing fixtures on Q-001 to $1,300",
      "plumbing fixtures",
      130_000,
    ],
    ["plumbing fixtures should be $1,300", "plumbing fixtures", 130_000],
    ["the tile is now $4,000", "tile", 400_000],
    ["plumbing fixtures to $1,300", "plumbing fixtures", 130_000],
    ["cambiar la plomería a $1,300", "plomería", 130_000],
    ["la plomería debe costar $1,300", "plomería", 130_000],
  ];
  for (const [text, match, amountCents] of cases) {
    assertEquals(parseLineReprice(text), { match, amountCents }, text);
  }
});

Deno.test("REQ-315 parseLineReprice: adding or crediting work, a change order phrase, a new material and an unnamed target are NOT a reprice", () => {
  for (
    const text of [
      "add a heated floor, $1,200",
      "add heated floor to $1,200",
      "credit $50 for the missed visit",
      "Change order for Maria: add fridge cleaning $40",
      "change the tile to porcelain, $300",
      "change it to $500",
      "change the total to $9,650",
      "make it $400",
      // something NEW, said with a price verb, is an addition
      "set up a fridge cleaning at $40",
      "put in a new vanity at $500",
      "make a new line for the heated floor at $1,200",
      "plumbing fixtures",
      "",
    ]
  ) assertEquals(parseLineReprice(text), undefined, text);
});

Deno.test("REQ-315 M26 changeOrderAsReprice: the demo model's change_order is the reprice it describes; a real addition stays a change order", () => {
  const DEMO_ASK =
    "Change plumbing fixtures to $1,300 on the quote I already sent (Q-001) and send her the new version.";
  // the description itself reads as a reprice ("Adjust X to $N", delta $150)
  assertEquals(
    changeOrderAsReprice(
      { description: "Adjust plumbing fixtures to $1,300" },
      DEMO_ASK,
    ),
    { match: "plumbing fixtures", amountCents: 130_000 },
  );
  // the user asked to reprice X and the change order is about X
  assertEquals(
    changeOrderAsReprice(
      { description: "Plumbing fixtures upgrade" },
      DEMO_ASK,
    ),
    { match: "plumbing fixtures", amountCents: 130_000 },
  );
  // an addition stays an addition
  assertEquals(
    changeOrderAsReprice(
      { description: "Heated floor" },
      "Change order for Dana Whitfield on Q-001: add a heated floor, $1,200.",
    ),
    undefined,
  );
  // the user repriced one line but the change order adds something else
  assertEquals(
    changeOrderAsReprice({ description: "Pressure wash" }, DEMO_ASK),
    undefined,
  );
});

// REQ-445 (demo-loop cycle 3, B2): "make it around $18,000" read as a reprice
// of a line called "it around". "it" / "that" / "this" are the job or a
// pointer to a line, and "around" / "about" are how sure the price is —
// neither is part of a line's name.
Deno.test("REQ-445 B2 parseLineReprice: 'make it around $18,000' names no line; 'make that vanity $900' and 'make the tile around $4,000' name theirs", () => {
  assertEquals(parseLineReprice("make it around $18,000"), undefined);
  assertEquals(parseLineReprice("make it about $18,000"), undefined);
  assertEquals(
    parseLineReprice(
      "no no eso está muy bajo!! $2,585 for a whole master bath?? make it around $18,000 and add the shower bench and mold remediation allowance",
    ),
    undefined,
  );
  assertEquals(parseLineReprice("make that vanity $900"), {
    match: "vanity",
    amountCents: 90_000,
  });
  assertEquals(parseLineReprice("make this vanity $900"), {
    match: "vanity",
    amountCents: 90_000,
  });
  assertEquals(parseLineReprice("make the tile around $4,000"), {
    match: "tile",
    amountCents: 400_000,
  });
  // still not a line: the pronoun alone (REQ-315)
  assertEquals(parseLineReprice("make it $500"), undefined);
});
