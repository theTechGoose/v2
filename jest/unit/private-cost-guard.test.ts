/**
 * REQ-261 — demo issue M26: the AI put the contractor's private plumber cost
 * into its proposed customer job details ("El plomero Ray cobra $2,800").
 *
 * Costs the contractor mentions (a sub's fee, a material cost, "Ray charges
 * $2,800") are PRIVATE — they inform the price, they never belong in customer
 * job details. Two guards:
 *  1. shared/quote-flow/private-cost.ts — the deterministic post-filter every
 *     LLM bullet headed for `description` / `descriptionByLang` goes through:
 *     a line that names a money amount is dropped.
 *  2. Both chat system prompts (systemQuote, systemTerms), in en AND es, carry
 *     the PRIVATE COSTS rule.
 */
type Mod = {
  mentionsMoney: (line: string) => boolean;
  withoutMoneyLines: (lines: string[]) => string[];
  withoutMoneySentences: (text: string) => string;
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mod: Mod = require("../../shared/quote-flow/private-cost");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const en: Record<string, string> = require("../../lang/en.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const es: Record<string, string> = require("../../lang/es.json");

describe("REQ-261 (M26) private costs never reach customer job details", () => {
  test.each([
    "Plumber Ray charges $2,800 for the rough-in",
    "El plomero Ray cobra $2,800 por la instalación",
    "Plumbing rough-in $2800",
    "Materials: 1,200 dollars",
    "Materiales 900 dólares",
    "Sub cost 2800 USD",
    "Tile at $4.50/sqft",
    "$ 300 deposit",
  ])("REQ-261 mentionsMoney flags a money amount: %s", (line) => {
    expect(mod.mentionsMoney(line)).toBe(true);
  });

  test.each([
    "Plumbing rough-in",
    "Install 2 bathroom sinks",
    "Replace 3 fence posts",
    "Paint 1,500 sqft interior",
    "Instalación de plomería",
    "",
  ])("REQ-261 mentionsMoney leaves scope lines alone: %s", (line) => {
    expect(mod.mentionsMoney(line)).toBe(false);
  });

  test("REQ-261 withoutMoneyLines drops only the priced lines, order kept", () => {
    expect(
      mod.withoutMoneyLines([
        "Bathroom plumbing rough-in",
        "Plumber Ray charges $2,800 for the rough-in",
        "Install new shutoff valves",
      ]),
    ).toEqual(["Bathroom plumbing rough-in", "Install new shutoff valves"]);
  });

  test("REQ-261 withoutMoneySentences drops the priced sentence from a paragraph", () => {
    expect(
      mod.withoutMoneySentences(
        "Rough-in plumbing for the new bathroom. Ray the plumber charges $2,800. Includes shutoff valves.",
      ),
    ).toBe("Rough-in plumbing for the new bathroom. Includes shutoff valves.");
    expect(mod.withoutMoneySentences("Line one\nRay $2800\nLine two")).toBe(
      "Line one\nLine two",
    );
  });

  test.each(["prompts.systemQuote", "prompts.systemTerms"])(
    "REQ-261 %s carries the PRIVATE COSTS rule in en and es",
    (key) => {
      for (const dict of [en, es]) {
        const p = dict[key];
        expect(p).toContain("PRIVATE COSTS");
        expect(p).toMatch(/subcontractor/i);
        expect(p).toMatch(/never put a dollar amount/i);
      }
    },
  );
});
