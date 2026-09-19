/// <reference types="cypress" />

/**
 * REQ-034 — NW-43f (p40): "There is no back button for the steps. Needs a
 * back button throughout so they can easily be edited." The /quotes?open=<id>
 * detail panel had no close/back control at all (the invoice panel has an X
 * that also strips ?open= from the URL — that is the model).
 */
export {};

describe("REQ-034 NW-43f the /quotes?open= panel can be closed", () => {
  const PHONE = "+15125550928";
  let quoteId: string;

  before(() => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "en");
    cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "en" });
    cy.request("POST", "/api/me/onboarded", { skipped: true });
    cy.apiCreateCustomer({
      name: "Panel Pat",
      email: "panel.pat@blackhole.postmarkapp.com",
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

  beforeEach(() => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "en");
    cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "en" });
    cy.request("POST", "/api/me/onboarded", { skipped: true });
  });

  it("REQ-034 an X on the panel closes it and strips ?open= from the URL, keeping the page", () => {
    cy.visit(`/quotes?open=${quoteId}`);
    cy.get("[data-cy=quote-open-panel]", { timeout: 10_000 }).should("be.visible");
    cy.get("[data-cy=quote-panel-close]").should("be.visible").click();
    cy.get("[data-cy=quote-open-panel]").should("not.exist");
    cy.location("pathname").should("eq", "/quotes");
    cy.location("search").should("not.contain", "open=");
  });
});
