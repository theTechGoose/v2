/// <reference types="cypress" />

/**
 * RED (TDD) — UX-01 [LANDING/MOBILE] "The signup card — the single conversion
 * point — is clipped at 390px. After tapping any 'Empezar' CTA (#contact
 * anchor), the card's inner content is pushed ~56px right: the headline wraps
 * off-screen ('¿Listo para quitarte e…'), the step tracker ('3 LI…') is cut,
 * and the PHONE INPUT itself extends past the viewport (right edge 399px on a
 * 390px screen); the 'Regístrate' button is clipped too. (The /verify card
 * surface has the same bleed — interactive elements fit (button right=385)
 * but the white card + '3 LISTO' tracker are visibly cut.)"
 *
 * Live measurements (Playwright, 390×844, pm_lang=es, 2026-08-19) — every
 * signup-card element sits at left=56 / right=398.7 while the .contact-card
 * box ends at 370: headline 398.7, .pm-steps 398.7, #f-phone 398.7,
 * button.cf-cta 398.7. On /verify the .verify-card spans 24→417.6 (27.6px
 * past the viewport). document.scrollWidth stays 390, so the bleed renders
 * as CLIPPED content — rect checks, not page-scroll checks, are the pin.
 *
 * Selector grounding (front-end/routes/index.tsx):
 *   - #contact section + .contact-card               (index.tsx:996-998)
 *   - step tracker ol.pm-steps                       (index.tsx:1003-1024)
 *   - headline h2[data-i18n="cta.h2"]                (index.tsx:1025)
 *   - form #contact-form, input#f-phone              (index.tsx:1076,1099-1113)
 *   - submit button.cf-cta                           (index.tsx:1116)
 *   - nav CTA a.btn-primary[href="#contact"]         (index.tsx:317-323)
 * front-end/routes/verify.tsx:
 *   - .verify-card                                   (verify.tsx:58)
 *   - its ol.pm-steps ("3 LISTO" tracker)            (verify.tsx:70-87)
 *
 * Phones: +15125556001 ONLY — and only as the ?phone= display param of
 * /verify (no OTP is sent; verify.tsx just renders the number).
 */

const VP_W = 390;

/** Element must fit the 390px viewport horizontally (left ≥ 0, right ≤ 390).
 *  Half-pixel tolerance for subpixel layout. */
function assertFitsViewport(sel: string, label: string) {
  cy.get(sel).then(($el) => {
    const r = $el[0].getBoundingClientRect();
    expect(
      r.left,
      `${label} left ${r.left.toFixed(1)} must be ≥ 0`,
    ).to.be.at.least(-0.5);
    expect(
      r.right,
      `${label} right ${r.right.toFixed(1)} must fit the ${VP_W}px viewport`,
    ).to.be.at.most(VP_W + 0.5);
  });
}

describe("UX-01: signup card fits the 390px viewport after the Empezar anchor", () => {
  beforeEach(() => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "es");
    cy.viewport(VP_W, 844);
    cy.visit("/");
    // landing-scripts.js is deferred; the ES CTA proves applyLang("es") ran
    // and the layout is final (same gate as landing-mobile-390.cy.ts).
    cy.contains(".nav a", "Empezar");
    // Follow the #contact anchor exactly like the audited ad tap. The CTA
    // has class cta-scroll (index.tsx:320) — landing-scripts smooth-scrolls
    // without necessarily setting location.hash, so no hash assertion here.
    cy.get('.nav a.btn-primary[href="#contact"]').click();
    // The signup form is on-screen (scroll landed).
    cy.get("#contact-form").should("be.visible");
  });

  it("UX-01: the headline is not pushed off-screen", () => {
    // RED today: right edge 398.7 > 390 ("¿Listo para quitarte e…").
    assertFitsViewport('#contact h2[data-i18n="cta.h2"]', "signup headline");
  });

  it('UX-01: the "1 TU NÚMERO / 2 CÓDIGO / 3 LISTO" step tracker is not cut', () => {
    // RED today: right edge 398.7 > 390 ("3 LI…" clipped).
    assertFitsViewport("#contact .pm-steps", "signup step tracker");
    assertFitsViewport(
      "#contact .pm-steps__item:last-child .pm-steps__label",
      'step-3 label ("LISTO")',
    );
  });

  it("UX-01: the phone input — the conversion point itself — fits the viewport", () => {
    // RED today: right edge 398.7 > 390 (audit measured 399).
    assertFitsViewport("#f-phone", "phone input");
  });

  it("UX-01: the submit button fits the viewport", () => {
    // RED today: right edge 398.7 > 390 (the "Regístrate" button is clipped).
    assertFitsViewport("#contact button.cf-cta", "submit button");
  });

  it("UX-01: the card's inner content stays inside the .contact-card surface", () => {
    // The mechanism behind all four clips: the inner column is pushed ~56px
    // right, so content (left 56 → right 398.7) overflows the card box
    // (20 → 370). Pin the containment so a fix that merely widens the page
    // instead of re-seating the content cannot go green.
    cy.get("#contact .contact-card").then(($card) => {
      const card = $card[0].getBoundingClientRect();
      cy.get("#f-phone").then(($input) => {
        const input = $input[0].getBoundingClientRect();
        expect(
          input.right,
          `phone input right ${input.right.toFixed(1)} inside card right ${
            card.right.toFixed(1)
          }`,
        ).to.be.at.most(card.right + 0.5);
      });
    });
  });
});

describe("UX-01: /verify card surface at 390px", () => {
  beforeEach(() => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "es");
    cy.viewport(VP_W, 844);
    // verify.tsx renders for any ?phone= without sending anything.
    cy.visit("/verify?phone=%2B15125556001");
    cy.get(".verify-card").should("be.visible");
  });

  it("UX-01: the white verify card does not bleed past the viewport", () => {
    // RED today: .verify-card spans 24 → 417.6 (27.6px past the 390 edge),
    // which is what visually cuts the card + "3 LISTO" corner. The tracker's
    // own rect (right 384.6) fits, so the honest pin is the card surface —
    // see the header note.
    assertFitsViewport(".verify-card", "verify card surface");
  });
});

export {};
