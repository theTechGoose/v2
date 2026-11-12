/**
 * REQ-238 (demo M27) — "Change order for Maria: add …" in the assistant
 * must change Maria's existing job, never draft a new separate quote.
 * These are the pure rules: reading the request, and picking the quote.
 */
import { assertEquals } from "#std/assert";
import {
  isChangeOrderRequest,
  parseChangeOrderRequest,
  pickChangeOrderTarget,
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
