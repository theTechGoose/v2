/// <reference types="cypress" />

/**
 * PDF p19 — "L10n spanish translation. Mexican, South American, and Latino
 * dialects."
 *
 * A Spanish-language user must see the whole quote flow in Spanish — no
 * English copy, no raw i18n keys — on both contractor and customer surfaces.
 */
describe("Spanish localization across the quote flow", () => {
  const PHONE = "+15125550946";

  function assertNoRawI18nKeys() {
    // Raw keys look like "asstChat.preview.menuCopyLink".
    cy.get("body")
      .invoke("text")
      .should("not.match", /\b[a-z]+[A-Z]\w*\.\w+\.\w+\b/);
  }

  beforeEach(() => {
    cy.clearCookies();
    cy.loginAs(PHONE);
    cy.request("POST", "/api/me/onboarded", { skipped: true }); // skip the /welcome trap for fresh users
    cy.apiUpdateUser({ language: "es" });
    cy.clearCookie("pm_lang"); // let the user's language win
  });

  it("the dashboard renders in Spanish", () => {
    cy.visit("/dashboard");
    cy.contains(/cotizaciones|facturas|clientes/i, { timeout: 10_000 }).should("be.visible");
    assertNoRawI18nKeys();
  });

  it("the assistant empty state renders its prompts in Spanish", () => {
    cy.visit("/assistant");
    cy.get("button.chat__empty-prompt").should("have.length.at.least", 2);
    // Wait (retrying) for the Spanish render first — islands may SSR EN and
    // flip after hydration (langSignal); a non-retrying .each would race it.
    cy.contains("button.chat__empty-prompt", /precio|cotización|trabajo/i, {
      timeout: 10_000,
    }).should("be.visible");
    cy.get("button.chat__empty-prompt").each(($btn) => {
      expect($btn.text(), "prompt is Spanish").not.to.match(
        /I know my price|I know the job|quick quote/i,
      );
    });
    assertNoRawI18nKeys();
  });

  it("the public quote renders in Spanish for a Spanish-language customer", () => {
    cy.seedQuoteToCash().then(({ quoteId }) => {
      cy.clearCookies();
      cy.setCookie("pm_lang", "es");
      cy.visit(`/q/${quoteId}`);
      cy.contains(/aceptar|firmar|cotización/i, { timeout: 10_000 }).should("be.visible");
      assertNoRawI18nKeys();
    });
  });

  it("the public contract signature section renders in Spanish", () => {
    cy.seedQuoteToCash().then(({ contractId }) => {
      cy.clearCookies();
      cy.setCookie("pm_lang", "es");
      cy.visit(`/c/${contractId}`);
      cy.contains(/firma|firmar/i, { timeout: 10_000 }).should("be.visible");
      assertNoRawI18nKeys();
    });
  });

  it("neutral Latin-American Spanish: no vosotros forms anywhere", () => {
    cy.visit("/dashboard");
    cy.get("body").invoke("text").should("not.match", /\bvosotros\b|\bhabéis\b|\bpodéis\b/i);
  });
});
