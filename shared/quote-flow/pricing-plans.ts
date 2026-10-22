/**
 * Pricing & offerings — set by Hans's "PM – Meeting Recap & Action Items
 * August 27-28, 2026" email (sent Aug 31, 2026), which supersedes the
 * raw-plan p20 deck (no free tier, $15 Starter / $99 / $199):
 *
 *   Monster Free         $0/month         unlimited invoices, max 5 quotes/month
 *   Monster              $99/month        the full self-service platform
 *   Monster Assist       $199/month       platform + phone/text/email help
 *   Monster Assist+      $399/month       higher-level expert assistance (REQ-118)
 *   Monster Projects     custom           scoped per customer — no number shown
 *
 * REQ-118 (Raphael, 2026-10-22: "add another tier called monster assist + 399"):
 * the tier Hans's email kept off the site as "Monster Assist Plus, $399–$599,
 * an onboarding/phone upsell" is a public tier now — Monster Assist+, one
 * price, $399 a month — listed after Monster Assist on every pricing section
 * and a card in onboarding and in settings like the other paid plans.
 *
 * Only `public` plans render on the pricing sections — the pages iterate
 * `PUBLIC_PLANS`, never `PRICING_PLANS`; the $1 test tier (REQ-064) is the one
 * hidden plan. Monster Projects IS on the site as the custom card, but its
 * structure ($600–$2,000/month of scoped work, or 1%–6% of profit on
 * qualifying jobs) is "discussed directly with customers rather than
 * displayed" — so the card says Custom and carries no figure.
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
  /** Monthly price. */
  priceCents: number;
  /**
   * Priced per engagement: the card shows "Custom" and no figure, and
   * `priceCents` is 0 only because a number is required.
   */
  custom?: boolean;
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
    // "Monster Free is 'Unlimited invoices'" (Hans, Sep 2): that is the pitch, so it leads.
    // REQ-109 (Raphael, 2026-10-21): the three lines, each its own, and free forever — the
    // introduction, the plan comparison and the signup messaging all read these.
    blurb: "Unlimited invoices. Up to five quotes and contracts a month. Spanish and English output. Free forever.",
    limits: { quotesPerMonth: 5 },
    features: [
      {
        id: "unlimited-invoices",
        en: "Unlimited invoices",
        es: "Facturas ilimitadas",
      },
      {
        id: "five-quotes",
        en: "Up to five quotes and contracts a month",
        es: "Hasta cinco cotizaciones y contratos al mes",
      },
      {
        id: "spanish-in-english-out",
        en: "Spanish and English output",
        es: "Documentos en español y en inglés",
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
  {
    id: "assist",
    name: "Monster Assist",
    priceCents: 19900,
    period: "monthly",
    public: true,
    blurb:
      "Everything in Monster, plus a real person on call by phone, text or email.",
    features: [
      {
        id: "everything-in-monster",
        en: "Everything in Monster",
        es: "Todo lo de Monster",
      },
      {
        id: "team-assistance",
        en: "Phone, text & email help from our team",
        es: "Ayuda de nuestro equipo por teléfono, texto y correo",
      },
      {
        id: "hands-on-help",
        en: "Hands-on help with your quotes, agreements & invoices",
        es: "Ayuda práctica con tus cotizaciones, acuerdos y facturas",
      },
    ],
  },
  // REQ-118 — "add another tier called monster assist + 399": the fourth card, after Monster Assist
  {
    id: "assist-plus",
    name: "Monster Assist+",
    priceCents: 39900,
    period: "monthly",
    public: true,
    blurb:
      "Everything in Monster Assist, plus higher-level expert and business help.",
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
  {
    id: "projects",
    name: "Monster Projects",
    priceCents: 0,
    custom: true,
    period: "monthly",
    public: true,
    blurb:
      "For bigger or specialized work outside the standard plans. Scoped directly with you.",
    features: [
      {
        id: "plan-reviews-takeoffs",
        en: "Large plan reviews & detailed takeoffs",
        es: "Revisión de planos grandes y cuantificaciones detalladas",
      },
      {
        id: "estimates-bids-proposals",
        en: "Major estimates, complex bids & proposals",
        es: "Estimados grandes, licitaciones y propuestas complejas",
      },
      {
        id: "scoped-with-you",
        en: "Monthly or performance-based — agreed with you",
        es: "Mensual o por resultados — acordado contigo",
      },
    ],
  },
  // ---- REQ-064: the test tier. A $1 one-time charge through the real pay page, for testing
  // the card flow (and a merchant account) end to end. Never on a page: not priced on the
  // landing pages, not a card in onboarding or settings — picked only from /plan/test. ----
  {
    id: "test",
    name: "Monster Test",
    priceCents: 100,
    period: "one-time",
    public: false,
    blurb: "A $1 one-time test charge. Not a membership.",
    features: [
      {
        id: "one-dollar-test",
        en: "A $1 one-time test charge",
        es: "Un cobro de prueba único de $1",
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
