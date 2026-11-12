import { assertEquals } from "#std/assert";
import { parseToolCall, TOOL_DEFS } from "./mod.ts";
import { TERMS_WIZARD_V1 } from "@agents/domain/business/terms-wizard-spec/mod.ts";

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

// REQ-263 (demo ai-assistant-m2): the job address the contractor typed rides
// on create_quote as `serviceAddress` instead of being thrown away.
Deno.test("REQ-263 parseToolCall: create_quote carries a trimmed serviceAddress", () => {
  const out = parseToolCall(call("create_quote", {
    summary: "Quote: Deep clean — Maria Lopez",
    serviceAddress: "  412 Oak St Austin ",
    lineItems: [{ description: "Deep clean", amountCents: 35_000 }],
  }));
  assertEquals(out?.type, "create_quote");
  if (out?.type === "create_quote") {
    assertEquals(out.payload.serviceAddress, "412 Oak St Austin");
  }
});

Deno.test("REQ-263 parseToolCall: a blank or non-string serviceAddress is left off", () => {
  for (const serviceAddress of ["   ", 42, null]) {
    const out = parseToolCall(call("create_quote", {
      summary: "x",
      serviceAddress,
      lineItems: [{ description: "ok", amountCents: 100 }],
    }));
    assertEquals(out?.type, "create_quote");
    if (out?.type === "create_quote") {
      assertEquals(Object.prototype.hasOwnProperty.call(out.payload, "serviceAddress"), false);
    }
  }
});

Deno.test("REQ-263 TOOL_DEFS: create_quote offers an optional serviceAddress string", () => {
  const def = TOOL_DEFS.find((d) => d.function.name === "create_quote")!;
  const params = def.function.parameters as unknown as {
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
  assertEquals(params.properties.serviceAddress?.type, "string");
  assertEquals(params.properties.serviceAddress.description.length > 0, true);
  assertEquals(params.required.includes("serviceAddress"), false);
});

// ---- REQ-258 (demo M22): "half deposit" must reach the quote ----------------
// create_quote had only {summary, lineItems}; a stated deposit / payment split
// had nowhere to go and was dropped. It now carries an optional paymentTerms —
// one of the terms wizard's payment_terms option ids — so the wizard can
// pre-select it.

Deno.test("REQ-258 create_quote schema offers an optional paymentTerms enum of the wizard's preset payment options", () => {
  const def = TOOL_DEFS.find((d) => d.function.name === "create_quote")!;
  const params = def.function.parameters as unknown as {
    properties: Record<string, { enum?: string[]; description?: string }>;
    required: string[];
  };
  const pt = params.properties.paymentTerms;
  assertEquals(typeof pt, "object");
  const wizardIds = TERMS_WIZARD_V1.steps
    .find((s) => s.id === "payment_terms")!
    .options.filter((o) => !o.isCustom)
    .map((o) => o.id);
  assertEquals(pt.enum, wizardIds);
  assertEquals(params.required.includes("paymentTerms"), false);
  // The description tells the model "half deposit" is 50_50.
  assertEquals(/half/i.test(pt.description ?? "") && (pt.description ?? "").includes("50_50"), true);
});

Deno.test("REQ-258 parseToolCall: create_quote passes a known paymentTerms through", () => {
  const out = parseToolCall(call("create_quote", {
    summary: "Interior painting",
    lineItems: [{ description: "Interior painting, paint supplied by contractor", amountCents: 240_000 }],
    paymentTerms: "50_50",
  }));
  assertEquals(out, {
    type: "create_quote",
    payload: {
      summary: "Interior painting",
      lineItems: [{ description: "Interior painting, paint supplied by contractor", amountCents: 240_000 }],
      paymentTerms: "50_50",
    },
  });
});

Deno.test("REQ-258 parseToolCall: create_quote drops an unknown or custom paymentTerms but keeps the quote", () => {
  for (const bad of ["half", "custom", 50, ""]) {
    const out = parseToolCall(call("create_quote", {
      summary: "Interior painting",
      lineItems: [{ description: "Interior painting", amountCents: 240_000 }],
      paymentTerms: bad,
    }));
    assertEquals(out, {
      type: "create_quote",
      payload: {
        summary: "Interior painting",
        lineItems: [{ description: "Interior painting", amountCents: 240_000 }],
      },
    });
  }
});

// REQ-262 (demo M25): after the quote exists the assistant had no way to
// change its job details ("I can't change the job details at this stage").
// update_job_details carries the description per language.
Deno.test("REQ-262 TOOL_DEFS: offers update_job_details with a per-language description", () => {
  const def = TOOL_DEFS.find((d) => d.function.name === "update_job_details");
  if (!def) throw new Error("update_job_details tool is missing");
  const props = (def.function.parameters as { properties: Record<string, unknown> }).properties;
  assertEquals(Object.keys(props).includes("descriptionByLang"), true);
});

Deno.test("REQ-262 parseToolCall: update_job_details keeps en/es text, joins bullet arrays, drops other keys", () => {
  const out = parseToolCall(call("update_job_details", {
    descriptionByLang: {
      en: "Repaint kitchen walls\nTwo coats",
      es: ["Repintar paredes de la cocina", " Dos capas "],
      fr: "Repeindre",
    },
  }));
  assertEquals(out, {
    type: "update_job_details",
    payload: {
      descriptionByLang: {
        en: "Repaint kitchen walls\nTwo coats",
        es: "Repintar paredes de la cocina\nDos capas",
      },
    },
  });
});

Deno.test("REQ-262 parseToolCall: update_job_details with no usable language returns undefined", () => {
  assertEquals(parseToolCall(call("update_job_details", { descriptionByLang: {} })), undefined);
  assertEquals(parseToolCall(call("update_job_details", { descriptionByLang: { en: "  " } })), undefined);
  assertEquals(parseToolCall(call("update_job_details", {})), undefined);
});
