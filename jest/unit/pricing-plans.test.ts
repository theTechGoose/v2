/**
 * Pricing & offerings — Hans's "PM – Meeting Recap & Action Items
 * August 27-28, 2026" email (Aug 31, 2026) plus his Sep 2 correction
 * ("Monster Assist is on the site and Monster Project is the custom;
 * Monster Assist Plus is the upsell; Monster Free is 'Unlimited invoices'"):
 *
 *   Monster Free         $0/month        unlimited invoices, max 5 quotes/month
 *   Monster              $99/month       full self-service platform
 *   Monster Assist       $199/month      platform + phone/text/email help
 *   Monster Projects     custom          scoped per customer, no figure shown
 *   Monster Assist Plus  $399–$599/month HIDDEN — onboarding/phone upsell
 *
 * No percentage fee on any membership plan.
 * Target: shared/quote-flow/pricing-plans.ts
 */
import {
  planById,
  planFeatures,
  PRICING_PLANS,
  PUBLIC_PLANS,
} from "../../shared/quote-flow/pricing-plans";

describe("PRICING_PLANS", () => {
  it("lists exactly four PUBLIC plans, in site order", () => {
    expect(PUBLIC_PLANS.map((p) => p.id)).toEqual([
      "free",
      "monster",
      "assist",
      "projects",
    ]);
    expect(PUBLIC_PLANS.map((p) => p.name)).toEqual([
      "Monster Free",
      "Monster",
      "Monster Assist",
      "Monster Projects",
    ]);
    expect(PUBLIC_PLANS.every((p) => p.public)).toBe(true);
  });

  it("Monster Free is $0/month and IS 'Unlimited invoices' — that leads; max 5 quotes a month", () => {
    const free = planById("free");
    expect(free.priceCents).toBe(0);
    expect(free.custom).toBeUndefined();
    expect(free.period).toBe("monthly");
    expect(free.limits).toEqual({ quotesPerMonth: 5 });
    expect(planFeatures("free", "en")[0]).toBe("Unlimited invoices");
    expect(planFeatures("free", "es")[0]).toBe("Facturas ilimitadas");
    expect(planFeatures("free", "en")).toContain("Up to 5 quotes a month");
    expect(free.blurb).toMatch(/^Unlimited invoices/);
  });

  it("Monster is $99/month — the full self-service platform, unlimited", () => {
    const monster = planById("monster");
    expect(monster.priceCents).toBe(9900);
    expect(monster.period).toBe("monthly");
    expect(monster.limits).toBeUndefined();
    expect(planFeatures("monster", "en").some((f) => /unlimited/i.test(f)))
      .toBe(true);
  });

  it("Monster Assist is $199/month and ON the site", () => {
    const assist = planById("assist");
    expect(assist.name).toBe("Monster Assist");
    expect(assist.priceCents).toBe(19900);
    expect(assist.public).toBe(true);
    expect(
      planFeatures("assist", "en").some((f) => /phone, text & email/i.test(f)),
    )
      .toBe(true);
  });

  it("Monster Projects is the custom card — public, no figure, no % anywhere", () => {
    const projects = planById("projects");
    expect(projects.name).toBe("Monster Projects");
    expect(projects.public).toBe(true);
    expect(projects.custom).toBe(true);
    expect(projects.priceMaxCents).toBeUndefined();
    for (const f of projects.features) {
      expect(f.en + f.es).not.toMatch(/\$|\d+\s?%/);
    }
  });

  it("Monster Assist Plus is the ONE hidden tier (onboarding/phone upsell)", () => {
    const plus = planById("assist-plus");
    expect(plus.name).toBe("Monster Assist Plus");
    expect(plus.priceCents).toBe(39900);
    expect(plus.priceMaxCents).toBe(59900);
    expect(plus.public).toBe(false);
    expect(PRICING_PLANS.filter((p) => !p.public).map((p) => p.id)).toEqual([
      "assist-plus",
    ]);
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
