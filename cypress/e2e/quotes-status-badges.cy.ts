/// <reference types="cypress" />

/**
 * PDF p10 — the quote badge must walk Draft → Sent → Viewed → Accepted:
 *  "If it is Sent lets have that change to 'Sent' and then 'Viewed' and then
 *   accepted once they sign." (Canonical status value is "accepted" — the
 *   legacy "approved" is dead; quotesPage.status.accepted renders
 *   "Accepted".)
 *
 * Contract selector: [data-cy=quote-status-badge] on the quote card/detail.
 * "Viewed" is triggered by the CUSTOMER opening the public quote (a
 * cookie-less request) — an owner's own view must not count.
 */
describe("quote status badge lifecycle", () => {
  const PHONE = "+15125550924";
  let quoteId: string;

  before(() => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "en");
    cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "en" }); // fresh users default to es; EN copy asserted
    cy.apiCreateCustomer({
      name: "Green Goblin",
      email: "green.badge@blackhole.postmarkapp.com",
      phoneNumber: "+15125550925",
    }).then((customerId) => {
      cy.apiCreateQuote({
        customerId,
        summary: "Removing junk from a backyard",
        jobName: "Backyard Junk Removal",
        lineItems: [{
          description: "Junk removal",
          quantity: 1,
          unit: "job",
          price: 55000,
        }],
        estimatedTotal: 55000,
      }).then((id) => {
        quoteId = id;
      });
    });
  });

  beforeEach(() => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "en"); // re-pin EN after the wipe (Spanish-first app)
    cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "en" }); // fresh users default to es; EN copy asserted
  });

  function badgeText() {
    cy.visit(`/quotes?open=${quoteId}`);
    return cy.get("[data-cy=quote-status-badge]", { timeout: 10_000 }).invoke(
      "text",
    );
  }

  /** Simulate the CUSTOMER opening the public quote: no session cookies. */
  function customerOpensQuote() {
    cy.clearCookies();
    cy.request(`/api/quotes/${quoteId}/public`);
    cy.setCookie("pm_lang", "en");
    cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "en" }); // fresh users default to es; EN copy asserted
  }

  it("starts as DRAFT", () => {
    badgeText().should("match", /draft/i);
  });

  it("flips to SENT after sending", () => {
    cy.apiSendQuoteEmail(quoteId);
    badgeText().should("match", /sent/i);
  });

  it("flips to VIEWED once the customer opens the public quote", () => {
    customerOpensQuote();
    badgeText().should("match", /viewed/i);
  });

  it("flips to ACCEPTED once the customer signs", () => {
    cy.apiAcceptQuote(quoteId, {
      signature: "Green Goblin",
      name: "Green Goblin",
    });
    badgeText().should("match", /accepted/i);
  });

  it("never regresses after acceptance — a later view keeps it ACCEPTED", () => {
    customerOpensQuote();
    badgeText().should("match", /accepted/i);
  });
});
