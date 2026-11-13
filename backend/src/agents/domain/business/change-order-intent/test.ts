/**
 * REQ-238 (demo M27) — "Change order for Maria: add …" in the assistant
 * must change Maria's existing job, never draft a new separate quote.
 * These are the pure rules: reading the request, and picking the quote.
 */
import { assertEquals } from "#std/assert";
import {
  askAmountExamples,
  isChangeOrderRequest,
  isCleanChangeClause,
  isNewQuoteRequest,
  parseChangeOrderRequest,
  parseTargetTotalChange,
  pickChangeOrderTarget,
  reconcileChangeOrderDelta,
  type TargetCustomer,
  type TargetQuote,
} from "./mod.ts";

Deno.test("REQ-238 isChangeOrderRequest: spots 'change order' in English and Spanish, and nothing else", () => {
  for (
    const s of [
      "Change order for Maria: add fridge cleaning $40",
      "change-order for the Lopez job, add $120 for haul away",
      "Need a CHANGE ORDER on Maria's quote",
      "Orden de cambio para Maria: limpieza del refri $40",
    ]
  ) assertEquals(isChangeOrderRequest(s), true, s);
  for (
    const s of [
      "Quote for Maria: fridge cleaning $40",
      "change the order of the line items",
      "I want to order a change of paint",
      "",
    ]
  ) assertEquals(isChangeOrderRequest(s), false, s);
});

Deno.test("REQ-238 parseChangeOrderRequest: the demo's sentence → Maria, 'Fridge cleaning', +$40", () => {
  assertEquals(
    parseChangeOrderRequest("Change order for Maria: add fridge cleaning $40"),
    {
      customerName: "Maria",
      description: "Fridge cleaning",
      deltaAmountCents: 4000,
    },
  );
});

Deno.test("REQ-238 parseChangeOrderRequest: full names, cents, thousands, credits", () => {
  assertEquals(
    parseChangeOrderRequest(
      "change order for Maria Lopez - add second coat of paint $1,250.50",
    ),
    {
      customerName: "Maria Lopez",
      description: "Second coat of paint",
      deltaAmountCents: 125050,
    },
  );
  assertEquals(
    parseChangeOrderRequest(
      "Change order for the Hendersons: remove the deck stain -$200",
    ),
    {
      customerName: "Hendersons",
      description: "Remove the deck stain",
      deltaAmountCents: -20000,
    },
  );
  assertEquals(
    parseChangeOrderRequest(
      "Change order for Maria: credit $50 for the missed visit",
    ),
    {
      customerName: "Maria",
      description: "Credit for the missed visit",
      deltaAmountCents: -5000,
    },
  );
  assertEquals(
    parseChangeOrderRequest(
      "Orden de cambio para María: agregar limpieza del refri $40",
    ),
    {
      customerName: "María",
      description: "Limpieza del refri",
      deltaAmountCents: 4000,
    },
  );
});

Deno.test("REQ-238 parseChangeOrderRequest: partial requests keep what they have; non-requests are undefined", () => {
  assertEquals(parseChangeOrderRequest("Change order for Maria"), {
    customerName: "Maria",
  });
  assertEquals(
    parseChangeOrderRequest("change order: add fridge cleaning $40"),
    { description: "Fridge cleaning", deltaAmountCents: 4000 },
  );
  assertEquals(
    parseChangeOrderRequest("Quote for Maria: fridge cleaning $40"),
    undefined,
  );
});

const at = (d: number) => new Date(Date.UTC(2026, 10, d)).toISOString();
const customers: TargetCustomer[] = [
  { id: "c-maria", name: "Maria Lopez" },
  { id: "c-maria2", name: "Maria Gomez" },
  { id: "c-bob", name: "Bob Reyes" },
];
const q = (
  id: string,
  customerId: string | undefined,
  status: string,
  d: number,
): TargetQuote => ({
  id,
  customerId,
  status,
  createdAt: at(d),
});

Deno.test("REQ-238 pickChangeOrderTarget: the named customer's one open quote", () => {
  const quotes = [q("q1", "c-maria", "sent", 1), q("q2", "c-bob", "sent", 2)];
  assertEquals(
    pickChangeOrderTarget({
      quotes,
      customers: customers.slice(0, 1).concat(customers[2]),
      customerName: "Maria",
    }),
    { kind: "quote", quoteId: "q1" },
  );
  // full name, any case, accents ignored
  assertEquals(
    pickChangeOrderTarget({ quotes, customers, customerName: "maría lopez" }),
    { kind: "quote", quoteId: "q1" },
  );
});

Deno.test("REQ-238 pickChangeOrderTarget: two customers called Maria with quotes → ask which", () => {
  const quotes = [
    q("q1", "c-maria", "sent", 1),
    q("q2", "c-maria2", "accepted", 2),
  ];
  assertEquals(
    pickChangeOrderTarget({ quotes, customers, customerName: "Maria" }),
    { kind: "ambiguous", quoteIds: ["q2", "q1"] },
  );
});

Deno.test("REQ-238 pickChangeOrderTarget: one customer, two open quotes → ask which; declined/expired never count", () => {
  assertEquals(
    pickChangeOrderTarget({
      quotes: [
        q("q1", "c-maria", "sent", 1),
        q("q2", "c-maria", "accepted", 3),
      ],
      customers,
      customerName: "Maria Lopez",
    }),
    { kind: "ambiguous", quoteIds: ["q2", "q1"] },
  );
  assertEquals(
    pickChangeOrderTarget({
      quotes: [
        q("q1", "c-maria", "declined", 1),
        q("q2", "c-maria", "accepted", 3),
        q("q3", "c-maria", "draft", 4),
      ],
      customers,
      customerName: "Maria Lopez",
    }),
    { kind: "quote", quoteId: "q2" },
  );
});

Deno.test("REQ-238 pickChangeOrderTarget: only a draft for the customer → that draft", () => {
  assertEquals(
    pickChangeOrderTarget({
      quotes: [q("q3", "c-bob", "draft", 4)],
      customers,
      customerName: "Bob",
    }),
    { kind: "quote", quoteId: "q3" },
  );
});

Deno.test("REQ-238 pickChangeOrderTarget: no such customer or no quote → none; no name and nothing bound → ask", () => {
  const quotes = [q("q1", "c-maria", "sent", 1)];
  assertEquals(
    pickChangeOrderTarget({ quotes, customers, customerName: "Zed" }),
    { kind: "none" },
  );
  assertEquals(
    pickChangeOrderTarget({ quotes: [], customers, customerName: "Bob" }),
    { kind: "none" },
  );
  assertEquals(pickChangeOrderTarget({ quotes, customers }), {
    kind: "ask_customer",
  });
});

Deno.test("REQ-238 pickChangeOrderTarget: the conversation's bound quote wins when no other customer is named", () => {
  const quotes = [
    q("q1", "c-maria", "sent", 1),
    q("q2", "c-maria", "accepted", 3),
  ];
  assertEquals(
    pickChangeOrderTarget({ quotes, customers, boundQuoteId: "q1" }),
    { kind: "quote", quoteId: "q1" },
  );
  assertEquals(
    pickChangeOrderTarget({
      quotes,
      customers,
      boundQuoteId: "q1",
      customerName: "Maria",
    }),
    { kind: "quote", quoteId: "q1" },
  );
  // bound to Bob's job but the user names Maria → Maria's quote, not the bound one
  assertEquals(
    pickChangeOrderTarget({
      quotes: [q("q1", "c-maria", "sent", 1), q("q9", "c-bob", "sent", 2)],
      customers,
      boundQuoteId: "q9",
      customerName: "Maria Lopez",
    }),
    { kind: "quote", quoteId: "q1" },
  );
});

// ---------------------------------------------------------------------------
// REQ-315 (demo-loop cycle 1, m49): "Change order for Dana Whitfield on
// Q-001: add a heated floor, $1,200." named the customer AND the quote and
// still got "Which customer's job is this change order for?" — the name
// could only end at 's, a delimiter, a change verb or the end of the text,
// never at "on Q-001". The name now also ends at on / for / about / re (es:
// en / sobre / de) and at a Q-number, the Q-number is read, and an explicit
// number resolves straight to that quote.
// ---------------------------------------------------------------------------

Deno.test("REQ-315 m49 parseChangeOrderRequest: the demo's sentence → Dana Whitfield, Q-001, 'Heated floor', +$1,200", () => {
  assertEquals(
    parseChangeOrderRequest(
      "Change order for Dana Whitfield on Q-001: add a heated floor, $1,200.",
    ),
    {
      customerName: "Dana Whitfield",
      quoteNumber: "Q-001",
      description: "Heated floor",
      deltaAmountCents: 120_000,
    },
  );
});

Deno.test("REQ-315 parseChangeOrderRequest: a name followed by on / for / about / re, a bare Q-number, and the Spanish forms", () => {
  assertEquals(
    parseChangeOrderRequest(
      "change order for Maria Lopez re Q-2: add a towel bar $80",
    ),
    {
      customerName: "Maria Lopez",
      quoteNumber: "Q-2",
      description: "Towel bar",
      deltaAmountCents: 8_000,
    },
  );
  // no name, just the number
  assertEquals(
    parseChangeOrderRequest("change order on Q-001: add a heated floor $1,200"),
    {
      quoteNumber: "Q-001",
      description: "Heated floor",
      deltaAmountCents: 120_000,
    },
  );
  // "about <job>" between the name and the change is a job reference, not the change
  assertEquals(
    parseChangeOrderRequest(
      "Change order for Maria about the deck: credit $50 for the missed visit",
    ),
    {
      customerName: "Maria",
      description: "Credit for the missed visit",
      deltaAmountCents: -5_000,
    },
  );
  assertEquals(
    parseChangeOrderRequest(
      "Orden de cambio para María en Q-001: agregar un piso radiante $1,200",
    ),
    {
      customerName: "María",
      quoteNumber: "Q-001",
      description: "Piso radiante",
      deltaAmountCents: 120_000,
    },
  );
});

Deno.test("REQ-315 pickChangeOrderTarget: an explicit quote number resolves to that quote — any case or zero padding — even when the name matches nobody", () => {
  const quotes: TargetQuote[] = [
    { ...q("q1", "c-maria", "sent", 1), number: "Q-001" },
    { ...q("q2", "c-bob", "sent", 2), number: "Q-002" },
  ];
  assertEquals(
    pickChangeOrderTarget({
      quotes,
      customers,
      customerName: "Dana Whitfield",
      quoteNumber: "Q-001",
    }),
    { kind: "quote", quoteId: "q1" },
  );
  assertEquals(
    pickChangeOrderTarget({ quotes, customers, quoteNumber: "q-2" }),
    { kind: "quote", quoteId: "q2" },
  );
  // bound to Maria's job but the user names Q-002 → Q-002
  assertEquals(
    pickChangeOrderTarget({
      quotes,
      customers,
      boundQuoteId: "q1",
      quoteNumber: "Q-002",
    }),
    { kind: "quote", quoteId: "q2" },
  );
});

Deno.test("REQ-315 pickChangeOrderTarget: an unknown or closed quote number → none (never a guess by name)", () => {
  const quotes: TargetQuote[] = [
    { ...q("q1", "c-maria", "sent", 1), number: "Q-001" },
    { ...q("q3", "c-maria", "declined", 3), number: "Q-003" },
  ];
  assertEquals(
    pickChangeOrderTarget({
      quotes,
      customers,
      customerName: "Maria",
      quoteNumber: "Q-009",
    }),
    { kind: "none" },
  );
  assertEquals(
    pickChangeOrderTarget({ quotes, customers, quoteNumber: "Q-003" }),
    { kind: "none" },
  );
});

Deno.test("REQ-315 M26 parseChangeOrderRequest: a reprice inside a change order is read as a reprice of that line — never an added line 'Change plumbing fixtures to' for +$1,300", () => {
  assertEquals(
    parseChangeOrderRequest(
      "Change order for Dana Whitfield on Q-001: change plumbing fixtures to $1,300",
    ),
    {
      customerName: "Dana Whitfield",
      quoteNumber: "Q-001",
      reprice: { match: "plumbing fixtures", amountCents: 130_000 },
    },
  );
  assertEquals(
    parseChangeOrderRequest(
      "change order for Dana: plumbing fixtures should be $1,300",
    ),
    {
      customerName: "Dana",
      reprice: { match: "plumbing fixtures", amountCents: 130_000 },
    },
  );
  assertEquals(
    parseChangeOrderRequest(
      "change order on Q-001: plumbing fixtures to $1,300",
    ),
    {
      quoteNumber: "Q-001",
      reprice: { match: "plumbing fixtures", amountCents: 130_000 },
    },
  );
  // an addition is still an addition
  assertEquals(
    parseChangeOrderRequest("Change order for Maria: add fridge cleaning $40"),
    {
      customerName: "Maria",
      description: "Fridge cleaning",
      deltaAmountCents: 4_000,
    },
  );
});

Deno.test("REQ-315 parseChangeOrderRequest: a job reference with no delimiter ends where the change starts — never at the comma inside $1,300", () => {
  assertEquals(
    parseChangeOrderRequest(
      "change order for Maria Lopez on the kitchen job add tile $300",
    ),
    {
      customerName: "Maria Lopez",
      description: "Tile",
      deltaAmountCents: 30_000,
    },
  );
  assertEquals(
    parseChangeOrderRequest(
      "change order for Dana on the bathroom change plumbing fixtures to $1,300",
    ),
    {
      customerName: "Dana",
      reprice: { match: "plumbing fixtures", amountCents: 130_000 },
    },
  );
  assertEquals(
    parseChangeOrderRequest(
      "change order for Maria about the deck add railing $1,200",
    ),
    {
      customerName: "Maria",
      description: "Railing",
      deltaAmountCents: 120_000,
    },
  );
});

// ---------------------------------------------------------------------------
// REQ-377 (demo-loop cycle 2, B1): "Dana wants a tile backsplash too — change
// Q-001 to $19,750" on an $18,500 quote added a $125 line: nothing read the
// target total in code, so the model did the subtraction into cents itself
// (12500 instead of 125000) and nothing checked it.
// ---------------------------------------------------------------------------

const PAIR5 = "Dana wants a tile backsplash too — change Q-001 to $19,750";

Deno.test("REQ-377 B1 parseTargetTotalChange: the demo's exact sentence is a new total for Q-001 plus a 'Tile backsplash' line", () => {
  assertEquals(parseTargetTotalChange(PAIR5), {
    quoteNumber: "Q-001",
    targetTotalCents: 1_975_000,
    description: "Tile backsplash",
  });
});

Deno.test("REQ-377 B1 parseTargetTotalChange: a new total with no item reads the total and leaves the description for the coordinator to ask", () => {
  assertEquals(parseTargetTotalChange("change Q-001 to $19,750"), {
    quoteNumber: "Q-001",
    targetTotalCents: 1_975_000,
  });
  assertEquals(parseTargetTotalChange("ok, make the total $19,200.50"), {
    targetTotalCents: 1_920_050,
  });
});

Deno.test("REQ-377 B1 parseTargetTotalChange: the other ways to say it (EN + ES)", () => {
  assertEquals(
    parseTargetTotalChange("add tile backsplash, new total $19,200"),
    { targetTotalCents: 1_920_000, description: "Tile backsplash" },
  );
  assertEquals(
    parseTargetTotalChange("Make Q-2's total $5,000 for the extra outlet"),
    {
      quoteNumber: "Q-2",
      targetTotalCents: 500_000,
      description: "Extra outlet",
    },
  );
  assertEquals(
    parseTargetTotalChange(
      "Bring the quote up to $9,800 — adding a heated floor",
    ),
    { targetTotalCents: 980_000, description: "Heated floor" },
  );
  assertEquals(
    parseTargetTotalChange(
      "Dana quiere un backsplash de azulejo — cambia Q-001 a $19,750",
    ),
    {
      quoteNumber: "Q-001",
      targetTotalCents: 1_975_000,
      description: "Backsplash de azulejo",
    },
  );
});

Deno.test("REQ-377 B1 parseTargetTotalChange: a line reprice, an added amount, or two amounts are not a new total", () => {
  assertEquals(
    parseTargetTotalChange("change plumbing fixtures to $1,300"),
    undefined,
  );
  assertEquals(
    parseTargetTotalChange("Change order for Maria: add fridge cleaning $40"),
    undefined,
  );
  assertEquals(
    parseTargetTotalChange("add tile $1,250 so the total is $19,750"),
    undefined,
  );
  assertEquals(
    parseTargetTotalChange("how much do i charge for panel swap 200a"),
    undefined,
  );
  assertEquals(parseTargetTotalChange(""), undefined);
});

Deno.test("REQ-377 B1 reconcileChangeOrderDelta: the demo model's 12500 for '$19,750' on an $18,500 quote is a decimal slip — the delta is $1,250", () => {
  assertEquals(
    reconcileChangeOrderDelta({
      deltaCents: 12_500,
      userText: PAIR5,
      bases: [1_850_000],
    }),
    { kind: "ok", deltaCents: 125_000 },
  );
});

Deno.test("REQ-377 B1 reconcileChangeOrderDelta: a delta that is a typed amount, or a typed amount minus the total or a line, stands", () => {
  // "add fridge cleaning $40" → +$40
  assertEquals(
    reconcileChangeOrderDelta({
      deltaCents: 4_000,
      userText: "Change order for Maria: add fridge cleaning $40",
      bases: [35_000],
    }),
    { kind: "ok", deltaCents: 4_000 },
  );
  // a credit of a typed amount
  assertEquals(
    reconcileChangeOrderDelta({
      deltaCents: -20_000,
      userText: "credit Dana $200 for the skipped stain",
      bases: [950_000],
    }),
    { kind: "ok", deltaCents: -20_000 },
  );
  // REQ-315: "change plumbing fixtures to $1,300" on a signed quote → +$150 (the line's difference)
  assertEquals(
    reconcileChangeOrderDelta({
      deltaCents: 15_000,
      userText: "change plumbing fixtures to $1,300",
      bases: [950_000, 120_000, 115_000, 480_000, 235_000],
    }),
    { kind: "ok", deltaCents: 15_000 },
  );
  // the right target-total difference
  assertEquals(
    reconcileChangeOrderDelta({
      deltaCents: 125_000,
      userText: PAIR5,
      bases: [1_850_000],
    }),
    { kind: "ok", deltaCents: 125_000 },
  );
});

Deno.test("REQ-377 B1 reconcileChangeOrderDelta: no dollar amount typed → the model's delta stands; one that fits nothing typed → ask", () => {
  assertEquals(
    reconcileChangeOrderDelta({
      deltaCents: 30_000,
      userText: "yes, add the extra day of labor",
      bases: [950_000],
    }),
    { kind: "ok", deltaCents: 30_000 },
  );
  assertEquals(
    reconcileChangeOrderDelta({
      deltaCents: 99_900,
      userText: PAIR5,
      bases: [1_850_000],
    }),
    { kind: "ask" },
  );
});

// ---------------------------------------------------------------------------
// REQ-438 (demo-loop cycle 3, M7): pair 6 typed "No es change order, es una
// cotización NUEVA…" and the denial itself read as a change order — the
// REQ-238 coercion then turned the model's create_quote into a change order
// with no customer, and the chat looped on "Which customer's job is this
// change order for?".
// ---------------------------------------------------------------------------

Deno.test("REQ-438 M7 isChangeOrderRequest: a denied 'change order' is not one", () => {
  for (
    const s of [
      "No es change order, es una cotización NUEVA para María José Peña, $180.",
      "No es change order, es una cotización NUEVA…",
      "It's not a change order, it's a new quote for Maria",
      "this isn't a change order — new job for Dana",
      "Not a change-order. Quote for Maria: faucet $180",
      "no es una orden de cambio, es un trabajo nuevo",
      "No change order please, just a new quote",
    ]
  ) {
    assertEquals(isChangeOrderRequest(s), false, s);
    assertEquals(parseChangeOrderRequest(s), undefined, s);
  }
  // an affirmed one next to a denial still counts
  assertEquals(
    isChangeOrderRequest(
      "Not a new quote — a change order for Maria: add fridge cleaning $40",
    ),
    true,
  );
});

Deno.test("REQ-438 M7 isNewQuoteRequest: 'cotización nueva / new quote' wins over change-order wording", () => {
  for (
    const s of [
      "No es change order, es una cotización NUEVA para María José Peña, $180.",
      "Nueva cotización para mi cliente María José Peña: llave $180",
      "Cotización para María José Peña: cambiar la llave del fregadero de la cocina, $180 todo incluido.",
      "New quote for Maria: replace kitchen faucet $180",
      "Quote for Maria: fridge cleaning $40",
      "make a separate quote for Dana, deck stain $900",
      "presupuesto nuevo para Ana: pintar cerca $300",
    ]
  ) assertEquals(isNewQuoteRequest(s), true, s);
  for (
    const s of [
      "Change order for Maria: add fridge cleaning $40",
      "Orden de cambio para Maria: limpieza del refri $40",
      "change Q-001 to $19,750",
      "how much should I quote for a panel swap?",
      "send the quote to Maria",
    ]
  ) assertEquals(isNewQuoteRequest(s), false, s);
  // an explicit NEW quote beats the change-order words in the same sentence
  assertEquals(
    isChangeOrderRequest(
      "Change order? No — a new quote for Maria: fridge cleaning $40",
    ),
    false,
  );
});

Deno.test("REQ-438 M7 askAmountExamples: the examples come from the job's own amounts, never $1,250 / $19,750", () => {
  // the demo: a $180 job, "$180" typed
  assertEquals(
    askAmountExamples({ currentTotalCents: 18_000, typed: [18_000] }),
    {
      exampleAdd: "$180",
      exampleTotal: "$360",
    },
  );
  // nothing typed: a tenth of the job, rounded to a round figure
  assertEquals(
    askAmountExamples({ currentTotalCents: 1_850_000, typed: [] }),
    { exampleAdd: "$1,850", exampleTotal: "$20,350" },
  );
  assertEquals(askAmountExamples({ currentTotalCents: 35_000, typed: [] }), {
    exampleAdd: "$35",
    exampleTotal: "$385",
  });
  // an empty job still gets a sensible example
  assertEquals(askAmountExamples({ currentTotalCents: 0, typed: [] }), {
    exampleAdd: "$100",
    exampleTotal: "$100",
  });
  // cents survive when the typed amount has them
  assertEquals(
    askAmountExamples({ currentTotalCents: 18_000, typed: [4_050] }),
    { exampleAdd: "$40.50", exampleTotal: "$220.50" },
  );
});

// ---------------------------------------------------------------------------
// REQ-455 (demo-loop cycle 3, M24): pair 5 typed a narrative sentence and the
// parser kept everything it didn't strip as the description, so the client's
// /co page read "Karen signed but now she wants to upgrade to a frameless
// glass shower door, add. Make a for and send it to her". A description is
// only read in code when the change clause is short and well-formed;
// otherwise it is left out and the coordinator asks the model.
// ---------------------------------------------------------------------------

const M24 =
  "Karen signed but now she wants to upgrade to a frameless glass shower door, add $1,200. Make a change order for Q-001 and send it to her.";

Deno.test("REQ-455 M24 parseChangeOrderRequest: the demo's narrative sentence keeps Q-001 and +$1,200 but never a garbled description", () => {
  const out = parseChangeOrderRequest(M24);
  assertEquals(out, { quoteNumber: "Q-001", deltaAmountCents: 120_000 });
});

Deno.test("REQ-455 M24 parseChangeOrderRequest: the description is cut at the first sentence boundary after the money", () => {
  assertEquals(
    parseChangeOrderRequest(
      "Change order for Maria: add fridge cleaning $40. Send it to her today.",
    ),
    {
      customerName: "Maria",
      description: "Fridge cleaning",
      deltaAmountCents: 4_000,
    },
  );
});

Deno.test("REQ-455 M24 isCleanChangeClause: short item clauses pass; long, multi-sentence or narrative ones don't", () => {
  for (
    const ok of [
      "Fridge cleaning",
      "Second coat of paint",
      "Remove the deck stain",
      "Credit for the missed visit",
      "Limpieza del refri",
    ]
  ) assertEquals(isCleanChangeClause(ok), true, ok);
  for (
    const bad of [
      "Karen signed but now she wants to upgrade to a frameless glass shower door, add",
      "Karen signed but now she wants to upgrade to a frameless glass shower door, add. Make a for and send it to her",
      "Upgrade to a frameless door. Then tile",
      "She wants a frameless door",
      "Make a door upgrade",
      "Door upgrade and send it",
      "one two three four five six seven eight nine",
    ]
  ) assertEquals(isCleanChangeClause(bad), false, bad);
});

// ---------------------------------------------------------------------------
// REQ-654 (demo-loop cycle 5, M10, pair 5): on the chat's own Q-001 draft
// card "Kitchen remodel — Dana Whitfield", Edit → "Change the quote: cabinets
// $7,000" got "I couldn't find a quote for Dana Whitfield, so I changed
// nothing." The model named the customer; the draft had no customerId yet
// (before the Who step), so the name matched no quote and the bound quote
// was never considered. The bound quote is the fallback before "none".
// ---------------------------------------------------------------------------

Deno.test("REQ-654 M10 pickChangeOrderTarget: the bound draft with no customer yet, and no such customer on file → the bound draft, never none", () => {
  assertEquals(
    pickChangeOrderTarget({
      quotes: [{ ...q("q-dana", undefined, "draft", 5) }],
      customers,
      boundQuoteId: "q-dana",
      customerName: "Dana Whitfield",
    }),
    { kind: "quote", quoteId: "q-dana" },
  );
});

Deno.test("REQ-654 M10 pickChangeOrderTarget: Dana is on file but the bound draft is not linked to her yet → the bound draft", () => {
  assertEquals(
    pickChangeOrderTarget({
      quotes: [
        q("q-dana", undefined, "draft", 5),
        q("q1", "c-maria", "sent", 1),
      ],
      customers: [...customers, { id: "c-dana", name: "Dana Whitfield" }],
      boundQuoteId: "q-dana",
      customerName: "Dana Whitfield",
    }),
    { kind: "quote", quoteId: "q-dana" },
  );
});

Deno.test("REQ-654 M10 pickChangeOrderTarget: the bound quote's own customer name (snapshot, or its card title) wins over an older quote of hers", () => {
  const dana = { id: "c-dana", name: "Dana Whitfield" };
  // the bound draft carries her name on its card, not her id; she has an
  // older signed job on file — the quote on screen is the one meant
  assertEquals(
    pickChangeOrderTarget({
      quotes: [
        q("q-old", "c-dana", "accepted", 1),
        {
          ...q("q-dana", undefined, "draft", 5),
          summary: "Kitchen remodel — Dana Whitfield",
        },
      ],
      customers: [...customers, dana],
      boundQuoteId: "q-dana",
      customerName: "Dana",
    }),
    { kind: "quote", quoteId: "q-dana" },
  );
  // a snapshot name counts the same way
  assertEquals(
    pickChangeOrderTarget({
      quotes: [
        q("q-old", "c-dana", "accepted", 1),
        {
          ...q("q-dana", undefined, "sent", 5),
          customerName: "Dana Whitfield",
        },
      ],
      customers: [...customers, dana],
      boundQuoteId: "q-dana",
      customerName: "Dana Whitfield",
    }),
    { kind: "quote", quoteId: "q-dana" },
  );
});

Deno.test("REQ-654 M10 pickChangeOrderTarget: a bound quote that belongs to someone else is never the fallback for another name", () => {
  // bound to Bob's job, the user names somebody with nothing on file → none
  assertEquals(
    pickChangeOrderTarget({
      quotes: [q("q9", "c-bob", "sent", 2)],
      customers,
      boundQuoteId: "q9",
      customerName: "Zed",
    }),
    { kind: "none" },
  );
  // a bound draft whose card names Bob is not Maria's
  assertEquals(
    pickChangeOrderTarget({
      quotes: [{
        ...q("q9", undefined, "draft", 2),
        summary: "Deck — Bob Reyes",
      }],
      customers,
      boundQuoteId: "q9",
      customerName: "Maria Lopez",
    }),
    { kind: "none" },
  );
});
