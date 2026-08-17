/// <reference types="cypress" />

/**
 * PDF p19 — "Login button on the landing page, top of view, takes you to a
 * clean login component. With the same login flow."
 *
 * Contract selector: [data-cy=landing-login] in the landing top nav.
 */
describe("landing page — top login button → clean login → same OTP flow", () => {
  beforeEach(() => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "en"); // re-pin EN after the wipe (Spanish-first app)
  });

  it("the landing page shows a Login button at the top of the view", () => {
    cy.visit("/landing");
    cy.get("[data-cy=landing-login]", { timeout: 10_000 }).should("be.visible");
    cy.get("[data-cy=landing-login]").then(($el) => {
      expect($el[0].getBoundingClientRect().top, "top-of-view placement")
        .to.be.lessThan(200);
    });
  });

  it("clicking it lands on a clean, dedicated login view", () => {
    cy.visit("/landing");
    cy.get("[data-cy=landing-login]").click();
    cy.location("pathname").should("eq", "/login");
    // Clean login component: a phone input front and center, no landing promo.
    cy.get("input[type=tel], input[name*=phone i]").should("be.visible");
  });

  it("the same OTP flow logs the user in from there", () => {
    cy.visit("/login");
    cy.get("input[type=tel], input[name*=phone i]").first().type("+15125550944");
    cy.contains("button", /continue|send|código|enviar/i).click();

    // Master OTP in dev.
    cy.get("input").filter("[inputmode=numeric], [autocomplete*=one-time]")
      .first()
      .type("000000");
    // Some flows auto-submit on the 6th digit; submit explicitly if a button remains.
    cy.get("body").then(($b) => {
      const btn = $b.find("button:contains('Verify'), button:contains('Verificar')");
      if (btn.length) cy.wrap(btn.first()).click();
    });

    cy.location("pathname", { timeout: 15_000 }).should("match", /dashboard|welcome|assistant/);
  });
});
