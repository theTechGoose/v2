/**
 * Pricing & offerings — Hans's "PM – Meeting Recap & Action Items
 * August 27-28, 2026" email (Aug 31, 2026), which supersedes PDF p20:
 *
 *   Monster Free         $0/month        max 5 quotes/month, unlimited invoices
 *   Monster              $99/month       full self-service platform
 *   Monster Assist       $199/month      HIDDEN — onboarding/phone upsell
 *   Monster Assist Plus  $399–$599/month HIDDEN — onboarding/phone upsell
 *
 * No percentage fee on any membership plan. Monster Projects is negotiated
 * per customer and is not a plan.
 * Target: shared/quote-flow/pricing-plans.ts
 */
import {
  planById,
  planFeatures,
  PRICING_PLANS,
  PUBLIC_PLANS,
} from "../../shared/quote-flow/pricing-plans";

describe("PRICING_PLANS", () => {
  it("lists exactly two PUBLIC plans, Monster Free then Monster", () => {
    expect(PUBLIC_PLANS.map((p) => p.id)).toEqual(["free", "monster"]);
    expect(PUBLIC_PLANS.map((p) => p.name)).toEqual(["Monster Free", "Monster"]);
    expect(PUBLIC_PLANS.every((p) => p.public)).toBe(true);
  });

  it("Monster Free is $0/month — max 5 quotes a month, unlimited invoices", () => {
    const free = planById("free");
    expect(free.priceCents).toBe(0);
    expect(free.period).toBe("monthly");
    expect(free.limits).toEqual({ quotesPerMonth: 5 });
    expect(planFeatures("free", "en")).toEqual(
      expect.arrayContaining(["5 quotes a month", "Unlimited invoices"]),
    );
    expect(planFeatures("free", "es")).toEqual(
      expect.arrayContaining(["5 cotizaciones al mes", "Facturas ilimitadas"]),
    );
  });

  it("Monster is $99/month — the full self-service platform, unlimited", () => {
    const monster = planById("monster");
    expect(monster.priceCents).toBe(9900);
    expect(monster.period).toBe("monthly");
    expect(monster.limits).toBeUndefined();
    expect(planFeatures("monster", "en").some((f) => /unlimited/i.test(f)))
      .toBe(true);
  });

  it("every Monster Assist tier exists for sales but is HIDDEN from the pages", () => {
    const assist = planById("assist");
    expect(assist.name).toBe("Monster Assist");
    expect(assist.priceCents).toBe(19900);
    expect(assist.public).toBe(false);

    const plus = planById("assist-plus");
    expect(plus.name).toBe("Monster Assist Plus");
    expect(plus.priceCents).toBe(39900);
    expect(plus.priceMaxCents).toBe(59900);
    expect(plus.public).toBe(false);

    const assistTiers = PRICING_PLANS.filter((p) => /assist/i.test(p.name));
    expect(assistTiers).toHaveLength(2);
    expect(assistTiers.every((p) => !p.public)).toBe(true);
    expect(PUBLIC_PLANS.some((p) => /assist/i.test(p.name))).toBe(false);
  });

  it("charges no percentage fee on any membership plan", () => {
    expect(PRICING_PLANS.every((p) => !("percentFee" in p))).toBe(true);
    for (const p of PRICING_PLANS) {
      for (const f of p.features) expect(f.en + f.es).not.toMatch(/\d+\s?%/);
    }
  });

  it("no plan still sells the retired $15 Starter / Pro / Crew tiers", () => {
    expect(
      PRICING_PLANS.some((p) =>
        p.priceCents === 1500 || /starter|^pro$|^crew$/i.test(p.name)
      ),
    ).toBe(false);
  });

  it("every plan bills monthly", () => {
    expect(PRICING_PLANS.every((p) => p.period === "monthly")).toBe(true);
  });
});
