/**
 * PDF p20 (Pricing) —
 *   "No Free" · "Get rid of the % for now" · "Starter Package at $15 per month"
 *   plus $99 and $199 tiers.
 *
 * Only the Starter's cadence is stated in the PDF ("per month"); the $99 and
 * $199 tiers pin AMOUNT only — their billing period is [DECIDE p20] (see
 * TDD-QUOTE-FLOW.md).
 * Target: shared/quote-flow/pricing-plans.ts
 */
import { PRICING_PLANS } from "../../shared/quote-flow/pricing-plans";

type Plan = {
  id: string;
  name: string;
  priceCents: number;
  period: "monthly" | "yearly" | "one-time";
  percentFee?: number;
  blurb?: string;
};

describe("PRICING_PLANS", () => {
  const plans = PRICING_PLANS as Plan[];

  it("has no free tier", () => {
    expect(plans.every((p) => p.priceCents > 0)).toBe(true);
    expect(plans.some((p) => /free|gratis/i.test(p.name))).toBe(false);
  });

  it("charges no percentage fee on any plan (for now)", () => {
    expect(plans.every((p) => !p.percentFee)).toBe(true);
  });

  it("offers the Starter package at $15 PER MONTH (the one stated cadence)", () => {
    const starter = plans.find((p) => /starter/i.test(p.name));
    expect(starter).toBeDefined();
    expect(starter!.priceCents).toBe(1500);
    expect(starter!.period).toBe("monthly");
  });

  it("offers the $99 and $199 tiers (amounts pinned; cadence is [DECIDE p20])", () => {
    const prices = plans.map((p) => p.priceCents);
    expect(prices).toContain(9900);
    expect(prices).toContain(19900);
  });

  it("is exactly three tiers", () => {
    expect(plans).toHaveLength(3);
  });
});
