/**
 * Pricing (raw-plan p20): no free tier, no percentage fee (for now).
 * Starter is $15/month (the one cadence the deck states); the $99/$199
 * tiers' cadence is [DECIDE p20] — modeled as monthly until decided.
 *
 * This module is the SINGLE source for what each plan costs AND for what each
 * plan includes. Both live landing pages read it:
 *
 *   /         front-end/routes/index.tsx   (via front-end/lib/landing-dict.ts,
 *                                           which projects the features onto
 *                                           the `price.tN.fM` data-i18n keys
 *                                           the client toggle uses)
 *   /landing  front-end/routes/landing.tsx (renders `plan.features` directly)
 *
 * Why: the two pages used to sell the same three prices with DIFFERENT
 * promises — the worst of them putting "Priority support" in the $99 tier on
 * one page and the $199 tier on the other. Prices were already single-sourced
 * here; the feature lists were not, so they drifted. Anything a plan promises
 * belongs in `features` below and nowhere else.
 */

/** One feature line, in both shipped languages. */
export interface PlanFeature {
  /** Stable id — safe to reference from tests/analytics, never rendered. */
  id: string;
  en: string;
  es: string;
}

export interface PricingPlan {
  id: string;
  name: string;
  priceCents: number;
  period: "monthly" | "yearly" | "one-time";
  blurb?: string;
  /** Everything this tier promises, in display order. */
  features: readonly PlanFeature[];
}

export const PRICING_PLANS: readonly PricingPlan[] = [
  {
    id: "starter",
    name: "Starter",
    priceCents: 1500,
    period: "monthly",
    blurb:
      "Legitimize your business for less than a Netflix subscription. Quotes, agreements, invoices.",
    features: [
      // "Unlimited" is the Starter pitch on BOTH pages — landing-consistency
      // and landing-pages pin that it never migrates to a higher tier.
      {
        id: "unlimited-docs",
        en: "Unlimited quotes, contracts & invoices",
        es: "Cotizaciones, contratos y facturas ilimitados",
      },
      {
        id: "spanish-in-english-out",
        en: "Spanish in, English out",
        es: "Escribes en español, sale en inglés",
      },
      { id: "e-signatures", en: "E-signatures", es: "Firmas electrónicas" },
      { id: "pm-assistant", en: "The PM Assistant", es: "El Asistente PM" },
    ],
  },
  {
    id: "pro",
    name: "Pro",
    priceCents: 9900,
    period: "monthly",
    features: [
      {
        id: "everything-in-starter",
        en: "Everything in Starter",
        es: "Todo lo de Starter",
      },
      {
        id: "sms-email-sending",
        en: "SMS & email sending",
        es: "Envío por SMS y correo",
      },
      {
        id: "payment-tracking",
        en: "Payment tracking + nudges",
        es: "Seguimiento de pagos y recordatorios",
      },
      { id: "change-orders", en: "Change orders", es: "Órdenes de cambio" },
    ],
  },
  {
    id: "crew",
    name: "Crew",
    priceCents: 19900,
    period: "monthly",
    features: [
      {
        id: "everything-in-pro",
        en: "Everything in Pro",
        es: "Todo lo de Pro",
      },
      {
        id: "multi-crew",
        en: "Multiple crews & jobs",
        es: "Varias cuadrillas y trabajos",
      },
      // Priority support belongs to exactly ONE tier. It is the top one:
      // /landing used to promise it at $99 while / promised it at $199, so a
      // visitor comparing the two pages saw the same benefit at two prices.
      {
        id: "priority-support",
        en: "Priority support",
        es: "Soporte prioritario",
      },
      {
        id: "hands-on-onboarding",
        en: "Hands-on onboarding",
        es: "Onboarding personalizado",
      },
    ],
  },
];

/** Look one plan up by id. Throws — a missing plan id is a wiring bug. */
export function planById(id: string): PricingPlan {
  const plan = PRICING_PLANS.find((p) => p.id === id);
  if (!plan) throw new Error(`unknown pricing plan: ${id}`);
  return plan;
}

/** Feature copy for one plan in one language, in display order. */
export function planFeatures(id: string, lang: "en" | "es"): string[] {
  return planById(id).features.map((f) => (lang === "es" ? f.es : f.en));
}
