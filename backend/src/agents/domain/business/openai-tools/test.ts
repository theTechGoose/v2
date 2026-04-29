import { assertEquals } from "#std/assert";
import { parseToolCall } from "./mod.ts";

function call(name: string, args: unknown) {
  return { function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) } };
}

Deno.test("parseToolCall: create_quote happy path returns the action with cents-truncated line items", () => {
  const out = parseToolCall(call("create_quote", {
    summary: "Quote: Kitchen remodel",
    customerId: "cust-1",
    lineItems: [
      { description: "Cabinets",     amountCents: 420_000 },
      { description: "Countertops",  amountCents: 399_000.7 },     // truncated
    ],
  }));
  assertEquals(out, {
    type: "create_quote",
    payload: {
      summary: "Quote: Kitchen remodel",
      customerId: "cust-1",
      lineItems: [
        { description: "Cabinets",     amountCents: 420_000 },
        { description: "Countertops",  amountCents: 399_000 },
      ],
    },
  });
});

Deno.test("parseToolCall: create_quote without customerId is allowed", () => {
  const out = parseToolCall(call("create_quote", {
    summary: "Quote: Bathroom",
    lineItems: [{ description: "Demo", amountCents: 80_000 }],
  }));
  assertEquals(out?.type, "create_quote");
  if (out?.type === "create_quote") assertEquals(out.payload.customerId, undefined);
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
