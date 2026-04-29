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
