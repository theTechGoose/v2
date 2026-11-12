/**
 * Single landing-offer source (P-08): both landing pages (routes/index.tsx and
 * routes/landing.tsx) plus static/landing-scripts.js sell ONE offer — one trial
 * claim, one from-price (derived from the cheapest public PAID plan, never
 * re-typed), one "unlimited" tier, one set of social-proof counters.
 *
 * Wiring sites: index.tsx (hero trust, cf-trust, pricing), landing.tsx (trial +
 * pricing), landing-scripts.js (doc counter), GET /api/admin/landing-offers.
 */

import { PUBLIC_PLANS } from "./pricing-plans.ts";

export interface LandingOffer {
  /** ONE trial claim for both pages (the /landing "30 days free" badge). */
  trialDays: number;
  /** "from $99/month" — the cheapest public PAID plan, never re-typed. */
  priceFromCents: number;
  /** Id of the ONE plan sold as "unlimited" (the full platform). */
  unlimitedTier: string;
  /**
   * Social-proof counters. ONE contractor counter for the whole site — the
   * root page used to show both "+1.200 contratistas" and a contradictory
   * "34 contractors signed up this week" (P-08); both lines now render this
   * number through `formatSocialProof`.
   */
  socialProof: { contractors: number; docsSent: number };
}

/** Cheapest public plan that costs money — the "from $…/month" number. */
const FROM_PLAN = [...PUBLIC_PLANS]
  .filter((p) => p.priceCents > 0)
  .sort((a, b) => a.priceCents - b.priceCents)[0];
if (!FROM_PLAN) throw new Error("PUBLIC_PLANS has no paid plan");

export const LANDING_OFFER: LandingOffer = {
  trialDays: 30,
  priceFromCents: FROM_PLAN.priceCents,
  unlimitedTier: "monster",
  socialProof: { contractors: 1200, docsSent: 48217 },
};

/**
 * Digit grouping for the social-proof counters: "1,200" in BOTH languages.
 * REQ-499 (demo p6): the landing's money is US-grouped in Spanish too
 * (REQ-413), so an es-grouped count ("+1.200") sat beside "$4,200.00" — one
 * number rule per page, the US one, like format-helpers' formatNumber (P-64).
 * Grouped manually — Spanish CLDR sets minimumGroupingDigits=2, so Intl would
 * leave 4-digit numbers ungrouped ("1200").
 */
export function formatSocialProof(n: number, _lang?: "en" | "es"): string {
  const grouped = Math.trunc(Math.abs(n))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return n < 0 ? `-${grouped}` : grouped;
}
