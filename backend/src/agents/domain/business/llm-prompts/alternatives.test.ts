/**
 * REQ-942 (LOOP-007 cycle 1, q1-1) — the quote prompt the chat model executes
 * says customer-facing alternatives are never added into one total, and its
 * tile example never puts a material the contractor did not type on the line.
 *
 * QA2 typed "two options: option A basic subway tile $9,800, option B large
 * format porcelain … $13,450"; the draft added both into $23,250, and option A
 * read "porcelain". The prompt's only options rule was "Listing 2-3 options
 * for the user to pick — pick the middle one yourself and fire", and its
 * "Tile bathroom 80 sqft" example answers "(80 sqft, porcelain)".
 */
import { assert } from "#std/assert";
import { SYSTEM_PROMPT_QUOTE } from "./mod.ts";

Deno.test("REQ-942 (LOOP-007 q1-1) quote prompt: alternatives the contractor gives (option A / option B) are never added into one total", () => {
  const rule =
    /(never|not|don't|do not)\s+(add|sum|total|combine)\w*[^.\n]{0,120}(alternative|option)|(alternative|option)s?\b[^.\n]{0,160}\b(never|not|don't|do not)\s+(add|sum|total|combine)/i;
  assert(
    rule.test(SYSTEM_PROMPT_QUOTE),
    "the quote prompt has no rule that alternatives / options are never added together",
  );
});

Deno.test("REQ-942 (LOOP-007 q1-1) quote prompt: the 'Tile bathroom 80 sqft' example puts no untyped material (porcelain) on the line", () => {
  const at = SYSTEM_PROMPT_QUOTE.indexOf("Input: 'Tile bathroom 80 sqft");
  const example = at >= 0
    ? SYSTEM_PROMPT_QUOTE.slice(
      at,
      SYSTEM_PROMPT_QUOTE.indexOf("Input:", at + 6),
    )
    : "";
  assert(
    !/porcelain/i.test(example),
    `the tile example injects a material nobody typed: ${example.trim()}`,
  );
});
