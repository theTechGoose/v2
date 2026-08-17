/// <reference types="cypress" />

/**
 * PDF p8 — "Post Quotes/Signed Quotes we need to send a completion Text and
 * Email."
 *
 * After sending, and again after the customer signs, the contractor-facing
 * UI must confirm that BOTH channels went out (the "CONTRACT EMAILED TO …
 * AND TEXTED TO …" receipt strip pattern from the deck).
 */
describe("completion text + email receipts", () => {
  const PHONE = "+15125550942";
  const CUSTOMER_EMAIL = "green.notify@example.com";
  let quoteId: string;

  beforeEach(() => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "en"); // re-pin EN after the wipe (Spanish-first app)
    cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "en" }); // fresh users default to es; EN copy asserted
    cy.apiCreateCustomer({
      name: "Green Goblin",
      email: CUSTOMER_EMAIL,
      phone: "+15125550943",
    }).then((customerId) => {
      cy.apiCreateQuote({
        customerId,
        summary: "Removing junk from a backyard",
        jobName: "Backyard Junk Removal",
        lineItems: [{ description: "Junk removal", quantity: 1, unit: "job", price: 55000 }],
        estimatedTotal: 55000,
      }).then((id) => {
        quoteId = id;
      });
    });
  });

  it("after sending, the quote surface confirms the email AND the text went out", () => {
    cy.apiSendQuoteEmail(quoteId);
    cy.request("POST", `/api/quotes/${quoteId}/text`);

    cy.visit(`/quotes?open=${quoteId}`);
    cy.contains(new RegExp(`emailed to ${CUSTOMER_EMAIL}`, "i"), { timeout: 10_000 })
      .should("be.visible");
    cy.contains(/texted to/i).should("be.visible");
  });

  it("after the customer signs, a completion receipt shows both channels again", () => {
    cy.apiSendQuoteEmail(quoteId);
    cy.apiAcceptQuote(quoteId, { signature: "Green Goblin", name: "Green Goblin" });

    cy.visit(`/quotes?open=${quoteId}`);
    cy.contains(/signed|approved/i, { timeout: 10_000 }).should("be.visible");
    // Completion confirmation must reference both channels.
    cy.contains(/emailed/i).should("be.visible");
    cy.contains(/texted/i).should("be.visible");
  });
});
