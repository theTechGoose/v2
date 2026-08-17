/// <reference types="cypress" />

/**
 * PDF p4 — "Why is contracts back?"
 *
 * Contracts were folded into the unified "Quote + Agreement" document; a
 * separate Contracts section must NOT reappear in the sidebar navigation.
 */
describe("sidebar navigation — no separate Contracts section (p4)", () => {
  const PHONE = "+15125550936";

  beforeEach(() => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "en"); // re-pin EN after the wipe (Spanish-first app)
    cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "en" }); // fresh users default to es; EN copy asserted
    cy.visit("/dashboard");
  });

  it("the sidebar does not list a Contracts entry", () => {
    // Scope to the app sidebar/nav to avoid matching page copy.
    cy.get("nav, [class*=side]").first().within(() => {
      cy.contains("a", /^contracts$/i).should("not.exist");
      cy.contains("a", /^contratos$/i).should("not.exist");
    });
  });

  it("the core sections remain", () => {
    cy.get("nav, [class*=side]").first().within(() => {
      cy.contains("a", /dashboard|inicio/i).should("exist");
      cy.contains("a", /quotes|cotizaciones/i).should("exist");
      cy.contains("a", /invoices|facturas/i).should("exist");
    });
  });

  it("deep-linking /contracts does not resurface a Contracts surface (redirects into quotes)", () => {
    cy.visit("/contracts", { failOnStatusCode: false });
    cy.location("pathname").should("not.eq", "/contracts");
  });
});
