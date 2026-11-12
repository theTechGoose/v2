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
