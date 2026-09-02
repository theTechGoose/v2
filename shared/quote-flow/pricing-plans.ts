/**
 * Pricing & offerings — set by Hans's "PM – Meeting Recap & Action Items
 * August 27-28, 2026" email (sent Aug 31, 2026), which supersedes the
 * raw-plan p20 deck (no free tier, $15 Starter / $99 / $199):
 *
 *   Monster Free         $0/month         max 5 quotes/month, unlimited invoices
 *   Monster              $99/month        the full self-service platform
 *   Monster Assist       $199/month       platform + phone/text/email help  HIDDEN
 *   Monster Assist Plus  $399–$599/month  higher-level expert assistance    HIDDEN
 *
 * Only `public` plans render on the pricing sections — the pages iterate
 * `PUBLIC_PLANS`, never `PRICING_PLANS`. Every Monster Assist tier is an
 * onboarding/phone upsell: it stays in this list so sales has ONE source for
 * what it costs and includes, but no page lists it. Monster Projects
 * ($600–$2,000/month of separately scoped work, or 1%–6% of profit on
 * qualifying jobs) is negotiated per customer and is not a membership plan,
 * so it is deliberately not modeled here.
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
 * Why: the two pages used to sell the same prices with DIFFERENT promises.
 * Prices were already single-sourced here; the feature lists were not, so
 * they drifted. Anything a plan promises belongs in `features` below and
 * nowhere else.
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
  /** Monthly price; the low end for a tier quoted as a range. */
  priceCents: number;
  /** High end of a range ("$399–$599/month"). Absent = a single price. */
  priceMaxCents?: number;
  period: "monthly" | "yearly" | "one-time";
  /**
   * Listed on the public pricing sections? `false` = sold only as an
   * onboarding/phone upsell — never rendered on a page.
   */
  public: boolean;
  blurb?: string;
  /**
   * Hard caps. Absent = unlimited. Display-only for now: enforcing the
   * "5 quotes a month" cap in the app is its own Sept. 8 action item.
   */
  limits?: { quotesPerMonth?: number };
  /** Everything this tier promises, in display order. */
  features: readonly PlanFeature[];
}

export const PRICING_PLANS: readonly PricingPlan[] = [
  {
    id: "free",
    name: "Monster Free",
    priceCents: 0,
    period: "monthly",
    public: true,
    blurb:
      "Legitimize your business for free. Up to 5 quotes a month, unlimited invoices.",
    limits: { quotesPerMonth: 5 },
    features: [
      {
        id: "five-quotes",
        en: "5 quotes a month",
        es: "5 cotizaciones al mes",
      },
      {
        id: "unlimited-invoices",
        en: "Unlimited invoices",
        es: "Facturas ilimitadas",
      },
      { id: "pm-assistant", en: "The PM Assistant", es: "El Asistente PM" },
      {
        id: "spanish-in-english-out",
        en: "Spanish in, English out",
        es: "Escribes en español, sale en inglés",
      },
    ],
  },
  {
    id: "monster",
    name: "Monster",
    priceCents: 9900,
    period: "monthly",
    public: true,
    blurb:
      "The full self-service platform. Win more jobs and get paid faster — without the chasing.",
    features: [
      {
        id: "everything-in-free",
        en: "Everything in Monster Free",
        es: "Todo lo de Monster Free",
      },
      // "Unlimited" is the Monster pitch on BOTH pages — landing-consistency
      // and landing-pages pin that it belongs to the same priced tier.
      {
        id: "unlimited-docs",
        en: "Unlimited quotes, agreements & invoices",
        es: "Cotizaciones, acuerdos y facturas ilimitados",
      },
      { id: "e-signatures", en: "E-signatures", es: "Firmas electrónicas" },
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
  // ---- Hidden tiers: onboarding/phone upsells, never listed on a page. ----
  {
    id: "assist",
    name: "Monster Assist",
    priceCents: 19900,
    period: "monthly",
    public: false,
    blurb: "The platform plus phone, text and email assistance from our team.",
    features: [
      {
        id: "everything-in-monster",
        en: "Everything in Monster",
        es: "Todo lo de Monster",
      },
      {
        id: "team-assistance",
        en: "Phone, text & email assistance from our team",
        es: "Ayuda de nuestro equipo por teléfono, texto y correo",
      },
    ],
  },
  {
    id: "assist-plus",
    name: "Monster Assist Plus",
    priceCents: 39900,
    priceMaxCents: 59900,
    period: "monthly",
    public: false,
    blurb: "Higher-level expert and business assistance.",
    features: [
      {
        id: "everything-in-assist",
        en: "Everything in Monster Assist",
        es: "Todo lo de Monster Assist",
      },
      {
        id: "expert-assistance",
        en: "Higher-level expert & business assistance",
        es: "Asesoría experta y de negocio de alto nivel",
      },
    ],
  },
];

/** The plans the pricing sections list, in display order. */
export const PUBLIC_PLANS: readonly PricingPlan[] = PRICING_PLANS.filter(
  (p) => p.public,
);

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
