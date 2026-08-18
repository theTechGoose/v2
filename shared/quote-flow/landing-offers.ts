/**
 * Single landing-offer source (P-08): both landing pages (routes/index.tsx and
 * routes/landing.tsx) plus static/landing-scripts.js sell ONE offer — one trial
 * claim, one from-price (derived from the Starter plan, never re-typed), one
 * "unlimited" tier, one set of social-proof counters.
 *
 * Wiring sites: index.tsx (hero trust, cf-trust, pricing), landing.tsx (trial +
 * pricing), landing-scripts.js (doc counter), GET /api/admin/landing-offers.
 */

import { PRICING_PLANS } from "./pricing-plans.ts";

export interface LandingOffer {
  /** ONE trial claim for both pages (the /landing "30 days free" badge). */
  trialDays: number;
  /** "from $15/month" — derived from the Starter plan, never re-typed. */
  priceFromCents: number;
  /** Id of the ONE plan sold as "unlimited" (root page's price.t1.f1). */
  unlimitedTier: string;
  /**
   * Social-proof counters. ONE contractor counter for the whole site — the
   * root page used to show both "+1.200 contratistas" and a contradictory
   * "34 contractors signed up this week" (P-08); both lines now render this
   * number through `formatSocialProof`.
   */
  socialProof: { contractors: number; docsSent: number };
}

const STARTER = PRICING_PLANS.find((p) => p.id === "starter");
if (!STARTER) throw new Error("PRICING_PLANS is missing the starter plan");

export const LANDING_OFFER: LandingOffer = {
  trialDays: 30,
  priceFromCents: STARTER.priceCents,
  unlimitedTier: "starter",
  socialProof: { contractors: 1200, docsSent: 48217 },
};

/**
 * Localized digit grouping for the social-proof counters: "1,200" (en) /
 * "1.200" (es). Grouped manually — Spanish CLDR sets minimumGroupingDigits=2,
 * so Intl.NumberFormat("es") leaves 4-digit numbers ungrouped ("1200").
 */
export function formatSocialProof(n: number, lang: "en" | "es"): string {
  const separator = lang === "es" ? "." : ",";
  const grouped = Math.trunc(Math.abs(n))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, separator);
  return n < 0 ? `-${grouped}` : grouped;
}
