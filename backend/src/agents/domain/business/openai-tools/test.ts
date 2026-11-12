import { assertEquals } from "#std/assert";
import { parseToolCall, TOOL_DEFS } from "./mod.ts";

function call(name: string, args: unknown) {
  return { function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) } };
}

Deno.test("parseToolCall: create_quote happy path returns the action with cents-truncated line items", () => {
  const out = parseToolCall(call("create_quote", {
    summary: "Quote: Kitchen remodel",
    lineItems: [
      { description: "Cabinets",     amountCents: 420_000 },
      { description: "Countertops",  amountCents: 399_000.7 },     // truncated
    ],
  }));
  assertEquals(out, {
    type: "create_quote",
    payload: {
      summary: "Quote: Kitchen remodel",
      lineItems: [
        { description: "Cabinets",     amountCents: 420_000 },
        { description: "Countertops",  amountCents: 399_000 },
      ],
    },
  });
});

// customerId was previously accepted but the model populated it with raw
// names (e.g. "Mendez") that aren't valid IDs, corrupting joins. The field
// is gone from the schema; conversation-level customer binding is now the
// only source of truth.
Deno.test("parseToolCall: create_quote ignores any customerId argument", () => {
  const out = parseToolCall(call("create_quote", {
    summary: "Quote: Bathroom",
    customerId: "ignored-string",
    lineItems: [{ description: "Demo", amountCents: 80_000 }],
  }));
  assertEquals(out?.type, "create_quote");
  if (out?.type === "create_quote") {
    assertEquals(Object.prototype.hasOwnProperty.call(out.payload, "customerId"), false);
  }
});

Deno.test("parseToolCall: create_quote with empty lineItems returns undefined", () => {
  const out = parseToolCall(call("create_quote", { summary: "x", lineItems: [] }));
  assertEquals(out, undefined);
});

Deno.test("parseToolCall: create_quote drops malformed items but keeps valid ones", () => {
  const out = parseToolCall(call("create_quote", {
    summary: "x",
    lineItems: [
      { description: "ok",   amountCents: 100 },
      { description: "bad" },                            // missing amount
      { amountCents: 200 },                              // missing description
      { description: "nan",  amountCents: "100" },       // wrong type
      { description: "good", amountCents: 300 },
    ],
  }));
  assertEquals(out?.type, "create_quote");
  if (out?.type === "create_quote") {
    assertEquals(out.payload.lineItems.map((l) => l.description), ["ok", "good"]);
  }
});

Deno.test("parseToolCall: lock_quote happy path", () => {
  assertEquals(parseToolCall(call("lock_quote", { quoteId: "q-1" })), {
    type: "lock_quote",
    payload: { quoteId: "q-1" },
  });
});

Deno.test("parseToolCall: lock_quote without quoteId returns undefined", () => {
  assertEquals(parseToolCall(call("lock_quote", {})), undefined);
});

Deno.test("parseToolCall: request_terms_transition happy path", () => {
  assertEquals(parseToolCall(call("request_terms_transition", { quoteId: "q-1" })), {
    type: "request_terms_transition",
    payload: { quoteId: "q-1" },
  });
});

Deno.test("parseToolCall: unknown tool name returns undefined", () => {
  assertEquals(parseToolCall(call("delete_universe", { yes: true })), undefined);
});

Deno.test("parseToolCall: malformed JSON arguments returns undefined", () => {
  assertEquals(parseToolCall(call("create_quote", "{ not json")), undefined);
});

Deno.test("parseToolCall: empty summary in create_quote returns undefined", () => {
  const out = parseToolCall(call("create_quote", {
    summary: "",
    lineItems: [{ description: "x", amountCents: 1 }],
  }));
  assertEquals(out, undefined);
});

// REQ-238 (demo M27): the assistant can ask for a change order instead of a
// brand-new quote.
Deno.test("REQ-238 TOOL_DEFS: the assistant has a change_order tool", () => {
  const names = TOOL_DEFS.map((d) => d.function.name);
  assertEquals(names.includes("change_order"), true);
});

Deno.test("REQ-238 parseToolCall: change_order happy path carries customer, description and signed cents", () => {
  assertEquals(
    parseToolCall(call("change_order", { customerName: "Maria", description: "Fridge cleaning", deltaAmountCents: 4000.9 })),
    { type: "change_order", payload: { customerName: "Maria", description: "Fridge cleaning", deltaAmountCents: 4000 } },
  );
  assertEquals(
    parseToolCall(call("change_order", { description: "Skip the deck stain", deltaAmountCents: -20000 })),
    { type: "change_order", payload: { description: "Skip the deck stain", deltaAmountCents: -20000 } },
  );
});

Deno.test("REQ-238 parseToolCall: change_order without a description or amount returns undefined", () => {
  assertEquals(parseToolCall(call("change_order", { customerName: "Maria", deltaAmountCents: 4000 })), undefined);
  assertEquals(parseToolCall(call("change_order", { customerName: "Maria", description: "Fridge" })), undefined);
});
