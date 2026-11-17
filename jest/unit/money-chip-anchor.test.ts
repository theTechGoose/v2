/**
 * REQ-329 — fix every issue the demo found (cycle 1); this one is demo issue p15-13 (pair 7):
 * "presets $50/$100/$500/$1k/$5k — silly for an $18k job".
 *
 * MoneyInput's quick chips were a static list; the island had no idea the AI had just suggested
 * $15k/$18k/$22k. The chips now derive from an optional anchor (the market tier) as nice-number
 * fractions/multiples of it, and the magnitude bar scales to the same anchor.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CHIP_PRESETS_CENTS,
  chipPresetsFor,
  magnitudeFill,
} from "../../front-end/lib/money-input";

const ROOT = join(__dirname, "..", "..");

describe("REQ-329 chipPresetsFor", () => {
  it("REQ-329: an $18,000 anchor gives $9k · $13.5k · $18k · $22.5k · $27k", () => {
    expect(chipPresetsFor(18_000_00)).toEqual([
      9_000_00,
      13_500_00,
      18_000_00,
      22_500_00,
      27_000_00,
    ]);
  });

  it("REQ-329: a $347 anchor snaps to a $5 grid around the exact anchor", () => {
    expect(chipPresetsFor(347_00)).toEqual([
      175_00,
      260_00,
      347_00,
      435_00,
      520_00,
    ]);
  });

  it("REQ-329: a $1,850 anchor snaps to a $50 grid", () => {
    expect(chipPresetsFor(1_850_00)).toEqual([
      950_00,
      1_400_00,
      1_850_00,
      2_300_00,
      2_800_00,
    ]);
  });

  it("REQ-329: chips are ascending, unique, positive — a tiny anchor never collapses to duplicates or zero", () => {
    const chips = chipPresetsFor(3);
    expect(chips.every((c) => c > 0)).toBe(true);
    expect(new Set(chips).size).toBe(chips.length);
    expect([...chips].sort((a, b) => a - b)).toEqual(chips);
    expect(chips).toContain(3);
  });

  it("REQ-329: no anchor (undefined / null / 0 / negative) keeps the fixed list", () => {
    expect(chipPresetsFor(undefined)).toEqual(CHIP_PRESETS_CENTS);
    expect(chipPresetsFor(null)).toEqual(CHIP_PRESETS_CENTS);
    expect(chipPresetsFor(0)).toEqual(CHIP_PRESETS_CENTS);
    expect(chipPresetsFor(-5_00)).toEqual(CHIP_PRESETS_CENTS);
    expect(CHIP_PRESETS_CENTS).toEqual([
      50_00,
      100_00,
      500_00,
      1_000_00,
      5_000_00,
    ]);
  });
});

describe("REQ-329 magnitudeFill", () => {
  it("REQ-329: with an anchor the bar is linear and full at the top chip (1.5×)", () => {
    expect(magnitudeFill(0, 18_000_00)).toBe(0);
    expect(magnitudeFill(null, 18_000_00)).toBe(0);
    expect(magnitudeFill(9_000_00, 18_000_00)).toBeCloseTo(1 / 3, 6);
    expect(magnitudeFill(18_000_00, 18_000_00)).toBeCloseTo(2 / 3, 6);
    expect(magnitudeFill(27_000_00, 18_000_00)).toBe(1);
    expect(magnitudeFill(90_000_00, 18_000_00)).toBe(1);
  });

  it("REQ-329: without an anchor the bar keeps its log scale against $100M", () => {
    expect(magnitudeFill(0)).toBe(0);
    const fifty = magnitudeFill(50_00);
    const fiveK = magnitudeFill(5_000_00);
    expect(fifty).toBeGreaterThan(0.3); // "$50 reads"
    expect(fiveK).toBeLessThan(0.9); // "$5k still has headroom"
    expect(fiveK).toBeGreaterThan(fifty);
    expect(magnitudeFill(100_000_000_00)).toBeCloseTo(1, 6);
  });
});

describe("REQ-329 wiring", () => {
  const island = readFileSync(
    join(ROOT, "front-end/islands/MoneyInput.tsx"),
    "utf8",
  );
  const chat = readFileSync(
    join(ROOT, "front-end/islands/AsstChat.tsx"),
    "utf8",
  );

  it("REQ-329: MoneyInput takes anchorCents and renders chipPresetsFor(anchor), not the static list", () => {
    expect(island).toMatch(/anchorCents\?: number/);
    expect(island).toMatch(/chipPresetsFor\(/);
    expect(island).toMatch(/magnitudeFill\(/);
    expect(island).not.toMatch(/const CHIP_PRESETS_CENTS\s*=/);
  });

  it("REQ-329: AsstChat passes the market tier's price as the anchor on the price-capture screen", () => {
    const at = chat.indexOf("<MoneyInput");
    expect(at).toBeGreaterThan(-1);
    const usage = chat.slice(at, chat.indexOf("/>", at));
    expect(usage).toMatch(/anchorCents=\{priceAnchorCents\}/);
    // REQ-389: the market-tier pick moved into priceChipAnchorCents (lib/money-input.ts)
    expect(chat).toMatch(/priceAnchorCents = priceChipAnchorCents\(/);
    expect(
      readFileSync(join(ROOT, "front-end/lib/money-input.ts"), "utf8"),
    ).toMatch(/tier === "market"/);
  });
});
