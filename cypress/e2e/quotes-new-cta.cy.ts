/// <reference types="cypress" />

/**
 * REQ-307 (demo-loop cycle 1, issue M11) — "+ New quote" / "Nueva cotización"
 * on /quotes does nothing. The hero CTA must take the owner to the
 * assistant's new-conversation route in both languages.
 */
export {};

describe("REQ-307 M11 the /quotes hero CTA opens the assistant", () => {
  const PHONE = "+15125550957";

  beforeEach(() => {
    cy.clearCookies();
    cy.loginAs(PHONE);
    cy.request("POST", "/api/me/onboarded", { skipped: true });
  });

  it("REQ-307 EN: clicking .qph__cta on /quotes lands on /assistant", () => {
    cy.setCookie("pm_lang", "en");
    cy.apiUpdateUser({ language: "en" });
    cy.visit("/quotes");
    cy.get(".qph__cta", { timeout: 10_000 }).should("contain.text", "New quote").click();
    cy.location("pathname", { timeout: 15_000 }).should("eq", "/assistant");
  });

  it("REQ-307 ES: clicking .qph__cta on /quotes lands on /assistant", () => {
    cy.setCookie("pm_lang", "es");
    cy.apiUpdateUser({ language: "es" });
    cy.visit("/quotes");
    cy.get(".qph__cta", { timeout: 10_000 }).should("contain.text", "Nueva cotización").click();
    cy.location("pathname", { timeout: 15_000 }).should("eq", "/assistant");
  });
});
