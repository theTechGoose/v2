/**
 * REQ-449 — fix every issue the demo found (cycle 3); this one is demo issue
 * m48: "Tapping a price tier jumps ahead and reloads the page".
 *
 * Each tier card's onClick was `onPriceContinue(t.priceCents)`: with the job
 * details in hand that ran startQuoteFromRaw, which created the quote and did
 * a full `globalThis.location.href = /assistant/<id>` load — under copy that
 * says "Tap a suggestion, or enter your own below" next to a Continue button.
 * Now a tier tap SELECTS (fills the price box, marks the card) and Continue
 * advances; the hand-off into the wizard happens in place (replaceState +
 * island state), not as a page load.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { selectedTierIndex } from "../../front-end/lib/money-input";

const ROOT = join(__dirname, "..", "..");
const island = readFileSync(
  join(ROOT, "front-end/islands/AsstChat.tsx"),
  "utf8",
);
const en = JSON.parse(readFileSync(join(ROOT, "lang/en.json"), "utf8"));
const es = JSON.parse(readFileSync(join(ROOT, "lang/es.json"), "utf8"));

const TIERS = [
  { tier: "competitive" as const, priceCents: 1_200_00 },
  { tier: "market" as const, priceCents: 1_450_00 },
  { tier: "premium" as const, priceCents: 1_800_00 },
];

/** The body of a function declared in the island, up to the next top-level
 *  `function` declaration at the same indent. */
function fnBody(name: string): string {
  const start = island.indexOf(`function ${name}(`);
  expect(start).toBeGreaterThan(-1);
  const next = island.indexOf("\n  function ", start + 10);
  const nextAsync = island.indexOf("\n  async function ", start + 10);
  const ends = [next, nextAsync].filter((i) => i > -1);
  return island.slice(start, ends.length ? Math.min(...ends) : undefined);
}

describe("REQ-449 selectedTierIndex", () => {
  it("REQ-449 m48: the tier whose price is in the box is the selected one", () => {
    expect(selectedTierIndex(TIERS, 1_450_00)).toBe(1);
    expect(selectedTierIndex(TIERS, 1_200_00)).toBe(0);
    expect(selectedTierIndex(TIERS, 1_800_00)).toBe(2);
  });

  it("REQ-449 m48: a typed price that matches no tier, an empty box, or no tiers select nothing", () => {
    expect(selectedTierIndex(TIERS, 1_500_00)).toBe(-1);
    expect(selectedTierIndex(TIERS, null)).toBe(-1);
    expect(selectedTierIndex(TIERS, 0)).toBe(-1);
    expect(selectedTierIndex(null, 1_450_00)).toBe(-1);
    expect(selectedTierIndex([], 1_450_00)).toBe(-1);
  });
});

describe("REQ-449 AsstChat wiring", () => {
  const tierButton = (() => {
    const at = island.indexOf('data-cy="pricing-option"');
    expect(at).toBeGreaterThan(-1);
    return island.slice(at, island.indexOf("</button>", at));
  })();

  it("REQ-449 m48: a tier tap selects — it does not continue", () => {
    expect(tierButton).not.toContain("onPriceContinue(");
    expect(tierButton).toContain("selectPriceTier(t.priceCents)");
    expect(tierButton).toMatch(/aria-pressed=\{/);
    expect(tierButton).toContain("is-selected");
    const select = fnBody("selectPriceTier");
    expect(select).toContain("setPriceCents(");
    // the price box remounts with the tier's price
    expect(select).toContain("setPriceSeedRev(");
    expect(select).not.toContain("startQuoteFromRaw(");
  });

  it("REQ-449 m48: Continue hands off into the wizard in place — no page load", () => {
    const start = fnBody("startQuoteFromRaw");
    // A page load is only the fallback when the thread can't be read back.
    const nav = /location\.href\s*=\s*`\/assistant\/\$\{conv\.id\}`/g;
    const loads = [...start.matchAll(nav)].map((m) => m.index ?? -1);
    const fallback = start.indexOf("if (!detail");
    const inPlace = start.indexOf("setMessages(detail.messages)");
    expect(fallback).toBeGreaterThan(-1);
    expect(inPlace).toBeGreaterThan(fallback);
    for (const at of loads) {
      expect(at).toBeGreaterThan(fallback);
      expect(at).toBeLessThan(inPlace);
    }
    expect(start).toContain("history.replaceState(");
    expect(start).toContain("assistantClient.conversation(");
    expect(start).toContain("setPriceCaptureOpen(false)");
    expect(start).toContain("setMessages(");
  });

  it("REQ-449 m48: the step's copy says tap to choose, then Continue (en + es)", () => {
    expect(en["asstChat.price.tapSub"]).toMatch(/continue/i);
    expect(es["asstChat.price.tapSub"]).toMatch(/continuar/i);
  });
});
