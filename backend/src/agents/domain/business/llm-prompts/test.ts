import { assert, assertEquals } from "#std/assert";
import { SYSTEM_PROMPT_QUOTE, SYSTEM_PROMPT_TERMS } from "./mod.ts";
import { t } from "@core/i18n/mod.ts";

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

// REQ-258 (demo M22): "…2 coats, I supply paint. $2,400 total, half deposit."
// came back as "customer supplied paint" — the quote prompt never said the user
// is the contractor, and had no rule for a stated deposit. These are the rules
// the model executes; the tool's own field descriptions carry them too.
Deno.test("REQ-258 quote prompt: first person (I / we / my) is the contractor, and the supplier is never flipped", () => {
  assert(/I\/we\/my/.test(SYSTEM_PROMPT_QUOTE), "names I/we/my");
  assert(/the user is the contractor/i.test(SYSTEM_PROMPT_QUOTE), "says the user is the contractor");
  assert(SYSTEM_PROMPT_QUOTE.includes("'I supply paint'"), "carries the paint example");
  assert(/paint supplied by contractor/.test(SYSTEM_PROMPT_QUOTE), "maps it to the contractor");
  assert(/never flip/i.test(SYSTEM_PROMPT_QUOTE), "forbids flipping the supplier");
});

Deno.test("REQ-258 quote prompt: a stated deposit / payment split goes into paymentTerms", () => {
  assert(/paymentTerms/.test(SYSTEM_PROMPT_QUOTE));
  assert(/'half deposit'[^\n]*50_50/.test(SYSTEM_PROMPT_QUOTE), "half deposit → 50_50");
});

Deno.test("REQ-258 create_quote line-item description carries the contractor-perspective rule in both languages", () => {
  for (const lang of ["en", "es"] as const) {
    const d = t(lang, "prompts.tools.createQuote.lineItemDescription");
    assert(/contractor/i.test(d) && /never flip/i.test(d), `${lang}: ${d}`);
  }
});
