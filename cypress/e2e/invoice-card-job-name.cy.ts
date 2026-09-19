/// <reference types="cypress" />

/**
 * REQ-011 — NW-30 (p28): "There is no real way to tell invoices apart other
 * than customer name and price. There is a lot of wasted space that could
 * show the job description." The API row already carries jobName; the card
 * on /invoices must show it.
 */
describe("REQ-011 NW-30 invoice cards show the job name", () => {
  const PHONE = "+15125550936";

  beforeEach(() => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "en");
    cy.loginAs(PHONE);
    cy.request({ url: "/api/me/wipe", failOnStatusCode: false });
    cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "en" });
    cy.request("POST", "/api/me/onboarded", { skipped: true });
    cy.setCookie("pm_lang", "en");
  });

  it("REQ-011 NW-30 two invoices for the same customer and amount are told apart by their job names", () => {
    const due = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    cy.apiCreateCustomer({
      name: "Deck Customer",
      email: "deck.customer@blackhole.postmarkapp.com",
      phoneNumber: "+15125550937",
    }).then((customerId) => {
      cy.apiCreateInvoice({ customerId, amount: 45000, jobName: "Deck Staining", dueDate: due });
      cy.apiCreateInvoice({ customerId, amount: 45000, jobName: "Gutter Cleaning", dueDate: due });
    });
    cy.visit("/invoices");
    cy.get("[data-cy=invoice-card-job]", { timeout: 20_000 }).should("have.length.at.least", 2);
    // The list lives in the page's own scroll container (.content, overflow:auto);
    // cards below the fold count as clipped until scrolled into view.
    cy.contains("[data-cy=invoice-card-job]", "Deck Staining").scrollIntoView().should("be.visible");
    cy.contains("[data-cy=invoice-card-job]", "Gutter Cleaning").scrollIntoView().should("be.visible");
  });
});
