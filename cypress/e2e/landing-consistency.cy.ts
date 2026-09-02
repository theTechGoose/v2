/// <reference types="cypress" />

/**
 * RED (TDD) — browser-level offer/i18n consistency across the two landing pages.
 *
 * P-08 "Two landing pages selling contradictory offers. /landing: 'Prueba GRATIS
 *       por 30 días', 'Papeleo ilimitado' as the $99 differentiator. /: no trial
 *       anywhere … unlimited included at $15. Marketing numbers also fight each
 *       other … '34 contractors signed up this week' (form, hardcoded English)."
 * P-19 "Root hero showcase stays English in Spanish mode + EN-first SSR flash …
 *       the dict even contains an orphaned doc.q.tag: 'Cotización' that never
 *       applies. SSR is fully English with a Spanish title."
 * P-60 "/landing ES typos: 'Chatéa con nosotros' … 'Legitimiza' (prefer
 *       Legitima), 'crecer tu negocio' anglicism."
 */

// Trial claims only — deliberately does NOT match "ad-free Netflix" / "frees up".
const TRIAL_RE =
  /free trial|free for 30|30 days free|prueba gratis|gratis por 30|30 días gratis/i;

/** Whole-dollar price ("0" | "99") of the first plan element pitching "unlimited", or "none". */
function unlimitedPlanPrice(
  els: HTMLElement[],
  priceSelector: string,
): string {
  const plan = els.find((el) => /unlimited|ilimitad/i.test(el.textContent ?? ""));
  if (!plan) return "none";
  const price = plan.querySelector(priceSelector)?.textContent ?? "";
  return price.match(/\$\s?(\d+)/)?.[1] ?? "none";
}

describe("P-08 landing offer consistency (ES mode)", () => {
  beforeEach(() => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "es");
  });

  it("P-08 / and /landing agree on the free-trial claim (both or neither)", () => {
    cy.visit("/");
    // landing-scripts.js is deferred; "Empezar" proves applyLang("es") ran.
    cy.contains(".nav a", "Empezar");
    cy.get("body").invoke("text").then((rootText: string) => {
      cy.visit("/landing");
      cy.contains("h2, h1", /./); // page rendered
      cy.get("body").invoke("text").then((landingText: string) => {
        // Red today: / makes no trial claim; /landing headlines
        // "Prueba Paperwork Monster GRATIS por 30 días" / "30 días gratis".
        expect(
          TRIAL_RE.test(rootText),
          `trial claim on "/" (${TRIAL_RE.test(rootText)}) must match "/landing" (${
            TRIAL_RE.test(landingText)
          })`,
        ).to.eq(TRIAL_RE.test(landingText));
      });
    });
  });

  it('P-08 the "unlimited" pitch belongs to the same priced tier on both pages', () => {
    cy.visit("/");
    cy.contains(".nav a", "Empezar");
    cy.get(".pricing .tier").then(($tiers) => {
      const rootPrice = unlimitedPlanPrice([...$tiers], ".tier-price");
      cy.visit("/landing");
      cy.get(".pm-plan").then(($plans) => {
        const landingPrice = unlimitedPlanPrice([...$plans], ".pm-plan__price");
        // Red today: "/" = $15 (Starter: "Cotizaciones y acuerdos ilimitados"),
        // "/landing" = $99 (Pro: "Papeleo ilimitado con soporte prioritario…").
        expect(
          rootPrice,
          `unlimited tier on "/" ($${rootPrice}) vs "/landing" ($${landingPrice})`,
        ).to.eq(landingPrice);
      });
    });
  });

  it("P-08 no English social-proof line survives on / in Spanish mode", () => {
    cy.visit("/");
    cy.contains(".nav a", "Empezar");
    // Red today: routes/index.tsx:1020 hardcodes
    // "<strong>34 contractors</strong> signed up this week" with no data-i18n,
    // so applyLang("es") can never translate it.
    cy.get("body").invoke("text").should("not.contain", "signed up this week");
  });
});

describe("P-19 / hero showcase in Spanish mode", () => {
  beforeEach(() => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "es");
  });

  it('P-19 showcase renders Spanish after hydration ("Cotización" tag, no EN showcase strings)', () => {
    cy.visit("/");
    cy.contains(".nav a", "Empezar"); // applyLang("es") ran
    // Red today: applyLang only swaps [data-i18n] nodes; the showcase doc tag,
    // sign label and chat header are hardcoded EN (routes/index.tsx:333-406).
    cy.get(".hs-doc__tag").should("have.text", "Cotización");
    cy.get(".hs-doc__sign-label").invoke("text").should("not.match", /Signed/);
    cy.get(".hs-chat__name em").invoke("text").should("not.contain", "Online");
  });

  it("P-19 SSR with pm_lang=es delivers Spanish HTML — no EN first paint", () => {
    cy.request({ url: "/", headers: { Cookie: "pm_lang=es" } }).then(
      ({ body }: { body: string }) => {
        // Red today: SSR emits a bare <html>, EN hero lead, and
        // <span class="hs-doc__tag">Quote</span> + "Signed ✓".
        expect(body).to.match(/<html[^>]*\blang="es"/);
        expect(body).to.include("Nos escribes en español");
        expect(body).to.match(/hs-doc__tag[^>]*>\s*Cotización/);
        expect(body).to.not.include("You communicate with us in Spanish");
        expect(body).to.not.match(/hs-doc__tag[^>]*>\s*Quote\b/);
        expect(body).to.not.include("Signed ✓");
      },
    );
  });
});

describe("P-60 /landing Spanish copy", () => {
  it('P-60 "Chatea" / "Legitima" / "haz crecer tu negocio" — no typos, no anglicism', () => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "es");
    cy.visit("/landing");
    cy.get("body").invoke("text").then((text: string) => {
      // Red today (lang/es.json promoLanding.*):
      //   subStrong1/step1: "Chatéa con nosotros en español."
      //   pricingStarterBlurb: "Legitimiza tu negocio…"
      //   closeP: "Dedica más tiempo a crecer tu negocio."
      expect(text).to.not.include("Chatéa");
      expect(text).to.not.include("Legitimiza");
      expect(text).to.include("haz crecer tu negocio");
    });
  });
});
