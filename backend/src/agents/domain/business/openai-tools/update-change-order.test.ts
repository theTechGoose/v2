/**
 * REQ-462 (demo-loop cycle 3, M26) — the assistant can edit or withdraw an
 * existing change order by its number. The demo's model had no such tool and
 * called revise_quote on the signed quote instead.
 */
import { assertEquals, assertStringIncludes } from "#std/assert";
import { parseToolCall, TOOL_DEFS } from "./mod.ts";
import { chatToolsFor } from "@agents/domain/business/chat-routing/mod.ts";

const call = (args: Record<string, unknown>): unknown =>
  parseToolCall({
    function: { name: "update_change_order", arguments: JSON.stringify(args) },
  });

Deno.test("REQ-462 TOOL_DEFS: update_change_order takes the CO number, a new wording, the NEW amount in dollars and withdraw", () => {
  const defs = TOOL_DEFS as unknown as readonly {
    function: { name: string; description: string; parameters: unknown };
  }[];
  const def = defs.find((d) => d.function.name === "update_change_order");
  assertEquals(def !== undefined, true, "the tool exists");
  const params = def!.function.parameters as {
    properties: Record<string, { type: string }>;
    required: string[];
    additionalProperties: boolean;
  };
  assertEquals(
    Object.fromEntries(
      Object.entries(params.properties).map(([k, v]) => [k, v.type]),
    ),
    {
      changeOrderNumber: "string",
      description: "string",
      amountDollars: "number",
      withdraw: "boolean",
    },
  );
  assertEquals(params.required, ["changeOrderNumber"]);
  assertEquals(params.additionalProperties, false);
  // it says when to fire, and what never to call for it
  assertStringIncludes(def!.function.description, "CO-001");
  assertStringIncludes(def!.function.description, "never revise_quote");
});

Deno.test("REQ-462 parseToolCall: update_change_order converts dollars to cents in code and normalises the number", () => {
  assertEquals(
    call({
      changeOrderNumber: "co-001",
      amountDollars: 1000,
      description: "  Upgrade to frameless glass shower door ",
    }),
    {
      type: "update_change_order",
      payload: {
        changeOrderNumber: "CO-001",
        description: "Upgrade to frameless glass shower door",
        amountCents: 100_000,
      },
    },
  );
  assertEquals(
    call({ changeOrderNumber: "CO-2", amountDollars: -50.5 }),
    {
      type: "update_change_order",
      payload: { changeOrderNumber: "CO-2", amountCents: -5_050 },
    },
  );
  assertEquals(
    call({ changeOrderNumber: "CO-003", withdraw: true }),
    {
      type: "update_change_order",
      payload: { changeOrderNumber: "CO-003", withdraw: true },
    },
  );
});

Deno.test("REQ-462 parseToolCall: update_change_order with no CO number, or nothing to change, is dropped", () => {
  assertEquals(call({ changeOrderNumber: "CO-001" }), undefined);
  assertEquals(
    call({ changeOrderNumber: "CO-001", amountDollars: 0, description: " " }),
    undefined,
  );
  assertEquals(call({ amountDollars: 1000 }), undefined);
  assertEquals(
    call({ changeOrderNumber: "Q-001", amountDollars: 1000 }),
    undefined,
  );
  assertEquals(
    call({ changeOrderNumber: "CO-001", withdraw: false }),
    undefined,
  );
});

Deno.test("REQ-462 chatToolsFor: update_change_order is offered in both phases, whatever the quote's state", () => {
  for (
    const q of [
      undefined,
      { status: "draft" },
      { status: "sent", sentAt: "2026-11-12T05:00:00Z" },
      { status: "accepted", acceptedAt: "2026-11-12T05:00:00Z" },
    ]
  ) {
    for (const phase of ["quote", "terms"] as const) {
      assertEquals(
        (chatToolsFor(phase, q) as string[]).includes("update_change_order"),
        true,
        `${phase} ${JSON.stringify(q)}`,
      );
    }
  }
});
