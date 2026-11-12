/**
 * REQ-585 (demo-loop cycle 4, M4 + M30) — the assistant can change the
 * agreement terms it is told about in the chat: the start date, how long the
 * job takes, the payment terms. Pair 7's "we start monday nov 23", "empezamos
 * la próxima semana, no el próximo mes" and "its 2 and a half weeks not 2"
 * had no tool to go to and were ignored (fleet-6 stdout:226/251/254).
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { parseToolCall, TOOL_DEFS } from "./mod.ts";
import { chatToolsFor } from "@agents/domain/business/chat-routing/mod.ts";

const call = (args: Record<string, unknown>): unknown =>
  parseToolCall({
    function: { name: "update_terms", arguments: JSON.stringify(args) },
  });

Deno.test("REQ-585 TOOL_DEFS: update_terms takes the start, the time to complete and the payment terms — in the contractor's words, never a computed date", () => {
  const defs = TOOL_DEFS as unknown as readonly {
    function: { name: string; description: string; parameters: unknown };
  }[];
  const def = defs.find((d) => d.function.name === "update_terms");
  assert(def !== undefined, "the tool exists");
  const params = def!.function.parameters as {
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
    additionalProperties: boolean;
  };
  assertEquals(
    Object.fromEntries(
      Object.entries(params.properties).map(([k, v]) => [k, v.type]),
    ),
    { startDate: "string", duration: "string", paymentTerms: "string" },
  );
  assertEquals(params.additionalProperties, false);
  assertStringIncludes(def!.function.description, "start");
  assertStringIncludes(params.properties.startDate.description, "words");
});

Deno.test("REQ-585 parseToolCall: update_terms keeps each term the model gave, trimmed; nothing given is dropped", () => {
  assertEquals(
    call({ startDate: " monday nov 23 ", paymentTerms: "50_50" }),
    {
      type: "update_terms",
      payload: { startDate: "monday nov 23", paymentTerms: "50_50" },
    },
  );
  assertEquals(
    call({ duration: "2 and a half weeks" }),
    { type: "update_terms", payload: { duration: "2 and a half weeks" } },
  );
  assertEquals(call({}), undefined);
  assertEquals(call({ startDate: "  ", duration: 3 }), undefined);
});

Deno.test("REQ-585 chatToolsFor: update_terms is offered in the terms phase whatever the quote's state (the coordinator refuses a sent or signed one) — never in the quote phase", () => {
  const has = (
    phase: "quote" | "terms",
    q?: {
      status?: string;
      sentAt?: string;
      lockedAt?: string;
      acceptedAt?: string;
    },
  ) => (chatToolsFor(phase, q) as string[]).includes("update_terms");
  assert(has("terms", { status: "draft" }));
  assert(has("terms", { status: "draft", lockedAt: "2026-11-12T05:00:00Z" }));
  assert(has("terms", undefined));
  assert(has("terms", { status: "sent", sentAt: "2026-11-12T05:00:00Z" }));
  assert(
    has("terms", { status: "accepted", acceptedAt: "2026-11-12T05:00:00Z" }),
  );
  assert(!has("quote", { status: "draft" }));
  assert(!has("quote", undefined));
});
