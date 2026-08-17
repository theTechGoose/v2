/// <reference types="cypress" />

/**
 * PDF p20 (Pricing) —
 *   "No Free" · "Get rid of the % for now" · "Starter Package at $15 per
 *   month" ("legitimize your business with less than a Netflix no-ad
 *   subscription") · $99 · $199.
 */
describe("landing — pricing section", () => {
  beforeEach(() => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "en"); // re-pin EN after the wipe (Spanish-first app)
    cy.visit("/landing");
    cy.contains(/pricing|precios/i, { timeout: 10_000 })
      .scrollIntoView()
      .should("be.visible");
  });

  function pricingSection() {
    return cy.contains(/pricing|precios/i).parents("section, div[class*=pricing], div[id*=pricing]").first();
  }

  it("offers NO free tier", () => {
    pricingSection().within(() => {
      cy.contains(/\bfree\b|\bgratis\b/i).should("not.exist");
      cy.contains(/\$0\b/).should("not.exist");
    });
  });

  it("shows no percentage fee anywhere in the plans", () => {
    pricingSection().within(() => {
      cy.contains(/\d+\s?%/).should("not.exist");
    });
  });

  it("leads with the Starter package at $15 per month", () => {
    pricingSection().within(() => {
      cy.contains(/starter/i).should("be.visible");
      cy.contains(/\$15\b/).should("be.visible");
    });
  });

  it("offers the $99 and $199 tiers", () => {
    pricingSection().within(() => {
      cy.contains(/\$99\b/).should("be.visible");
      cy.contains(/\$199\b/).should("be.visible");
    });
  });

  it("shows exactly three plans", () => {
    pricingSection().within(() => {
      cy.get("[data-cy=pricing-plan]")
        .filter(":visible")
        .should("have.length", 3);
    });
  });
});
