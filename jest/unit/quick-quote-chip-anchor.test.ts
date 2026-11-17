/**
 * REQ-389 — fix every issue the demo found (cycle 2); this one is demo issue m31:
 * "Amount chips $50-$5k shown on $14,500/$18,500 jobs".
 *
 * REQ-329 scaled the amount pad's quick chips only from the AI's price tiers, so the
 * "Just give me a quick quote" / "I know my price" paths (no tiers) kept the fixed
 * $50…$5k chips even though the pad opened prefilled at the $18,500 typed in the sentence.
 * The anchor now falls back to the amount the pad was prefilled with.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CHIP_PRESETS_CENTS,
  chipPresetsFor,
  priceChipAnchorCents,
} from "../../front-end/lib/money-input";

const ROOT = join(__dirname, "..", "..");

const TIERS = [
  { tier: "competitive" as const, priceCents: 15_000_00 },
  { tier: "market" as const, priceCents: 18_000_00 },
  { tier: "premium" as const, priceCents: 22_000_00 },
];

describe("REQ-389 priceChipAnchorCents", () => {
  it("REQ-389 m31: no tiers + a prefilled $18,500 → the anchor is $18,500 (chips $9.5k…$28k, not $50…$5k)", () => {
    expect(priceChipAnchorCents(null, 18_500_00)).toBe(18_500_00);
    const chips = chipPresetsFor(priceChipAnchorCents(null, 18_500_00));
    expect(chips).not.toEqual(CHIP_PRESETS_CENTS);
    expect(chips).toContain(18_500_00);
  });

  it("REQ-389 m31: no tiers + a prefilled $14,500 → the anchor is $14,500", () => {
    expect(priceChipAnchorCents(null, 14_500_00)).toBe(14_500_00);
    expect(chipPresetsFor(priceChipAnchorCents(null, 14_500_00))).toContain(
      14_500_00,
    );
  });

  it("REQ-389: the market tier still wins over the prefill (REQ-329 unchanged)", () => {
    expect(priceChipAnchorCents(TIERS, 3_700_00)).toBe(18_000_00);
    expect(priceChipAnchorCents(TIERS.filter((t) => t.tier !== "market"), null))
      .toBe(15_000_00);
  });

  it("REQ-389: no tiers and no (or a non-positive) prefill → no anchor, the fixed chips", () => {
    expect(priceChipAnchorCents(null, null)).toBeNull();
    expect(priceChipAnchorCents(undefined, undefined)).toBeNull();
    expect(priceChipAnchorCents(null, 0)).toBeNull();
    expect(priceChipAnchorCents([], -5)).toBeNull();
    expect(chipPresetsFor(priceChipAnchorCents(null, null))).toEqual(
      CHIP_PRESETS_CENTS,
    );
  });
});

describe("REQ-389 wiring", () => {
  const chat = readFileSync(
    join(ROOT, "front-end/islands/AsstChat.tsx"),
    "utf8",
  );

  it("REQ-389 m31: AsstChat derives the anchor with priceChipAnchorCents from the tiers AND the prefilled amount", () => {
    expect(chat).toMatch(
      /priceChipAnchorCents\(\s*priceSuggestions,\s*prefillPriceCents,?\s*\)/,
    );
    // the quick-quote prefill feeds the anchor, not only priceCents
    const at = chat.indexOf("function submitJobDetails(");
    expect(at).toBeGreaterThan(-1);
    const body = chat.slice(at, chat.indexOf("\n  }\n", at));
    expect(body).toMatch(/setPrefillPriceCents\(/);
  });
});
