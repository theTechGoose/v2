/// <reference types="cypress" />

/**
 * REQ-048 (2026-09-30), Raphael: "the contract should be english first and
 * then there should be a toggle to turn the contract to spanish in real time.
 * should be easy to view in whatever language you want."
 *
 * The contractor here sends in SPANISH (commsLanguage es) — the case where
 * the old /q fell back to a Spanish document. The customer opens the link
 * with no language cookie at all.
 *
 * Copy pinned (lang/{en,es}.json): quoteDoc.contractValue "Agreement value" /
 * "Valor del acuerdo"; quoteDoc.terms "Terms" / "Términos".
 */
describe("REQ-048 public contract — English first, EN/ES toggle in real time", () => {
  const PHONE = "+15125550949";
  let quoteId: string;

  before(() => {
    cy.clearCookies();
    cy.loginAs(PHONE);
    cy.apiUpdateProfile({ businessName: "Toggle ES LLC", commsLanguage: "es" });
    cy.apiCreateCustomer({ name: "Lucía Ortega", phoneNumber: "+15125550950" })
      .then((customerId: string) => {
        cy.apiCreateQuote({
          customerId,
          summary: "Pintura interior",
          jobName: "Pintura interior",
          lineItems: [{ description: "Pintura", quantity: 1, unit: "job", price: 120000 }],
          estimatedTotal: 120000,
          terms: [{ stepId: "payment_terms", label: "Payment terms", value: "50 / 50" }],
        }).then((id: string) => {
          quoteId = id;
        });
      });
  });

  beforeEach(() => {
    cy.clearCookies();
    cy.clearLocalStorage();
  });

  it("REQ-048 the contract opens in English even when the contractor's comms language is Spanish", () => {
    cy.visit(`/q/${quoteId}`);
    cy.contains("Agreement value", { timeout: 10_000 }).should("be.visible");
    cy.get("body").invoke("text").should("not.include", "Valor del acuerdo");
    cy.get("button[data-contract-lang=en]").should("have.attr", "aria-pressed", "true");
    cy.get("button[data-contract-lang=es]").should("have.attr", "aria-pressed", "false");
  });

  it("REQ-048 the ES toggle flips the whole contract to Spanish in place, without a reload", () => {
    cy.visit(`/q/${quoteId}`);
    cy.contains("Agreement value", { timeout: 10_000 }).should("be.visible");
    // A marker on the window survives only if the page is NOT reloaded.
    cy.window().then((win) => {
      (win as unknown as { __pmSamePage: boolean }).__pmSamePage = true;
    });
    cy.get("button[data-contract-lang=es]").click();
    cy.contains("Valor del acuerdo").should("be.visible");
    cy.contains("Términos").should("be.visible");
    cy.get("body").invoke("text").should("not.include", "Agreement value");
    cy.window().its("__pmSamePage").should("eq", true);
    cy.get("button[data-contract-lang=es]").should("have.attr", "aria-pressed", "true");
    cy.location("search").should("eq", "?lang=es");
    cy.document().its("documentElement.lang").should("eq", "es");
    cy.title().should("match", /Cotización/);
  });

  it("REQ-048 the pick is remembered across a reload and EN flips it back", () => {
    cy.visit(`/q/${quoteId}`);
    cy.contains("Agreement value", { timeout: 10_000 }).should("be.visible");
    cy.get("button[data-contract-lang=es]").click();
    cy.contains("Valor del acuerdo").should("be.visible");
    // A plain visit (no ?lang=) now opens Spanish — the pick was persisted.
    cy.visit(`/q/${quoteId}`);
    cy.contains("Valor del acuerdo", { timeout: 10_000 }).should("be.visible");
    cy.get("button[data-contract-lang=en]").click();
    cy.contains("Agreement value").should("be.visible");
    cy.get("body").invoke("text").should("not.include", "Valor del acuerdo");
    cy.document().its("documentElement.lang").should("eq", "en");
  });
});
