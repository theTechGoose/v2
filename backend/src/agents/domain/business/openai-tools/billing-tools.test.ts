/**
 * REQ-583 (demo-loop cycle 4, M2) — the chat model can send the invoice and
 * record a payment. Its tools were create_quote, lock_quote,
 * request_terms_transition, change_order, update_job_details, revise_quote and
 * update_change_order: "send it to her now please" got "I can't send the
 * invoice directly…", "she paid the deposit by check" got "You can check the
 * payment status in the Invoices section.".
 */
import { assertEquals, assertStringIncludes } from "#std/assert";
import { parseToolCall, TOOL_DEFS } from "./mod.ts";

type Def = {
  function: { name: string; description: string; parameters: unknown };
};
const defs = TOOL_DEFS as unknown as readonly Def[];
const params = (name: string) =>
  defs.find((d) => d.function.name === name)?.function.parameters as {
    properties: Record<string, { type: string; enum?: string[] }>;
    required?: string[];
    additionalProperties: boolean;
  };
const call = (name: string, args: Record<string, unknown>): unknown =>
  parseToolCall({ function: { name, arguments: JSON.stringify(args) } });

Deno.test("REQ-583 TOOL_DEFS: send_invoice takes only which invoice (its number) — the server picks the rest", () => {
  const def = defs.find((d) => d.function.name === "send_invoice");
  assertEquals(def !== undefined, true, "the tool exists");
  const p = params("send_invoice");
  assertEquals(
    Object.fromEntries(
      Object.entries(p.properties).map(([k, v]) => [k, v.type]),
    ),
    { invoiceNumber: "string" },
  );
  assertEquals(p.required ?? [], []);
  assertEquals(p.additionalProperties, false);
  assertStringIncludes(def!.function.description, "never lock_quote");
});

Deno.test("REQ-583 TOOL_DEFS: record_payment takes the amount in dollars, how it was paid, the invoice and deposit / balance", () => {
  const def = defs.find((d) => d.function.name === "record_payment");
  assertEquals(def !== undefined, true, "the tool exists");
  const p = params("record_payment");
  assertEquals(
    Object.fromEntries(
      Object.entries(p.properties).map(([k, v]) => [k, v.type]),
    ),
    {
      amountDollars: "number",
      method: "string",
      invoiceNumber: "string",
      which: "string",
      reference: "string",
    },
  );
  assertEquals(p.properties.method.enum, [
    "cash",
    "check",
    "zelle",
    "venmo",
    "cashapp",
    "paypal",
    "card",
    "ach",
    "other",
  ]);
  assertEquals(p.properties.which.enum, ["deposit", "balance"]);
  assertEquals(p.required ?? [], []);
  assertEquals(p.additionalProperties, false);
  assertStringIncludes(def!.function.description, "Zelle");
});

Deno.test("REQ-583 parseToolCall: send_invoice normalises the number; no arguments is fine", () => {
  assertEquals(call("send_invoice", {}), {
    type: "send_invoice",
    payload: {},
  });
  assertEquals(call("send_invoice", { invoiceNumber: " inv-001 " }), {
    type: "send_invoice",
    payload: { invoiceNumber: "INV-001" },
  });
  // anything that isn't an invoice number is dropped, the send stays
  assertEquals(call("send_invoice", { invoiceNumber: "the last one" }), {
    type: "send_invoice",
    payload: {},
  });
});

Deno.test("REQ-583 parseToolCall: record_payment converts dollars to cents in code; an unknown method is 'other', not a guess", () => {
  assertEquals(
    call("record_payment", {
      amountDollars: 1425,
      method: "zelle",
      which: "deposit",
    }),
    {
      type: "record_payment",
      payload: { amountCents: 142_500, method: "zelle", which: "deposit" },
    },
  );
  assertEquals(
    call("record_payment", {
      amountDollars: 1200.5,
      method: "wire",
      invoiceNumber: "inv-2",
      reference: " 1043 ",
    }),
    {
      type: "record_payment",
      payload: {
        amountCents: 120_050,
        method: "other",
        invoiceNumber: "INV-2",
        reference: "1043",
      },
    },
  );
  // nothing but "she paid": still a payment to match
  assertEquals(call("record_payment", {}), {
    type: "record_payment",
    payload: {},
  });
  // a zero / negative / junk amount is no amount
  assertEquals(call("record_payment", { amountDollars: -5, which: "x" }), {
    type: "record_payment",
    payload: {},
  });
});
