/// <reference types="cypress" />

/**
 * PDF p8 + p19 — "Make it the mobile version/Friendly" / "Flawless mobile
 * view with the same perfect ux translated to small screens."
 *
 * On a 390px phone viewport, no core surface may scroll horizontally and the
 * primary action of each surface must be reachable.
 */
describe("mobile friendliness (390px)", () => {
  const PHONE = "+15125550945";

  function assertNoHorizontalScroll() {
    cy.window().then((win) => {
      const doc = win.document.documentElement;
      expect(
        doc.scrollWidth,
        `scrollWidth ${doc.scrollWidth} must not exceed viewport ${doc.clientWidth}`,
      ).to.be.at.most(doc.clientWidth + 1);
    });
  }

  beforeEach(() => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "en"); // re-pin EN after the wipe (Spanish-first app)
    cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "en" }); // fresh users default to es; EN copy asserted
    cy.request("POST", "/api/me/onboarded", { skipped: true }); // skip the /welcome trap for fresh users
    cy.viewport(390, 844);
  });

  const surfaces: Array<{ path: string; cta: RegExp }> = [
    { path: "/dashboard", cta: /assistant|asistente/i },
    { path: "/quotes", cta: /new|nueva|crear|\+/i },
    { path: "/invoices", cta: /new|nueva|crear|\+/i },
    { path: "/clients", cta: /new|nuevo|crear|\+/i },
    { path: "/assistant", cta: /.*/ },
    { path: "/settings", cta: /save|guardar/i },
  ];

  for (const { path, cta } of surfaces) {
    it(`${path} has no horizontal scroll and its primary action is reachable at 390px`, () => {
      cy.visit(path);
      cy.wait(500); // allow islands to hydrate/layout
      assertNoHorizontalScroll();
      // Scope to the page content — the off-canvas drawer duplicates nav
      // copy that would otherwise steal the match while hidden.
      cy.get("main").contains("button, a", cta).should("be.visible");
    });
  }

  it("the public Quote + Agreement (incl. the sign pad) is mobile friendly too", () => {
    // The quote IS the agreement: /q renders the full document and the one
    // signature ceremony (the old /c page is gone).
    cy.seedQuoteToCash().then(({ quoteId }) => {
      cy.clearCookies();
      cy.setCookie("pm_lang", "en");
      cy.visit(`/q/${quoteId}`);
      cy.wait(500);
      assertNoHorizontalScroll();
      // Primary action reachable: the signature ceremony's submit button
      // (its label flips from "Type your name to enable" to "Sign the
      // contract →" once a name is typed).
      cy.contains(/sign here/i).should("exist");
      cy.get("form.ctr__sign-form button[type=submit]")
        .scrollIntoView()
        .should("be.visible");
    });
  });

  it("assistant composer stays usable: input visible above the soft-keyboard area", () => {
    cy.visit("/assistant");
    cy.get("textarea.composer__input").should("be.visible").then(($el) => {
      const rect = $el[0].getBoundingClientRect();
      expect(rect.bottom).to.be.at.most(844);
      expect(rect.width).to.be.greaterThan(200);
    });
  });
});
