/**
 * Pricing (raw-plan p20): no free tier, no percentage fee (for now).
 * Starter is $15/month (the one cadence the deck states); the $99/$199
 * tiers' cadence is [DECIDE p20] — modeled as monthly until decided.
 */

export interface PricingPlan {
  id: string;
  name: string;
  priceCents: number;
  period: "monthly" | "yearly" | "one-time";
  blurb?: string;
}

export const PRICING_PLANS: readonly PricingPlan[] = [
  {
    id: "starter",
    name: "Starter",
    priceCents: 1500,
    period: "monthly",
    blurb: "Legitimize your business for less than a Netflix subscription. Quotes, agreements, invoices.",
  },
  {
    id: "pro",
    name: "Pro",
    priceCents: 9900,
    period: "monthly",
  },
  {
    id: "crew",
    name: "Crew",
    priceCents: 19900,
    period: "monthly",
  },
];
