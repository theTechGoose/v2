import { assert, assertEquals } from "#std/assert";
import { SYSTEM_PROMPT_QUOTE, SYSTEM_PROMPT_TERMS } from "./mod.ts";

Deno.test("llm-prompts: quote system prompt is a non-empty string", () => {
  assertEquals(typeof SYSTEM_PROMPT_QUOTE, "string");
  assert(SYSTEM_PROMPT_QUOTE.length > 0);
});

Deno.test("llm-prompts: terms system prompt is a non-empty string", () => {
  assertEquals(typeof SYSTEM_PROMPT_TERMS, "string");
  assert(SYSTEM_PROMPT_TERMS.length > 0);
});

Deno.test("llm-prompts: quote and terms are distinct prompts", () => {
  assert(SYSTEM_PROMPT_QUOTE !== SYSTEM_PROMPT_TERMS);
});

// REQ-261 (demo M26): both chat prompts tell the model a contractor's stated
// costs are private and never go into job details or customer text.
Deno.test("REQ-261 M26 quote and terms prompts carry the PRIVATE COSTS rule", () => {
  for (const p of [SYSTEM_PROMPT_QUOTE, SYSTEM_PROMPT_TERMS]) {
    assert(p.includes("PRIVATE COSTS"), "missing PRIVATE COSTS rule");
    assert(/never put a dollar amount/i.test(p), "rule must forbid dollar amounts");
  }
});
