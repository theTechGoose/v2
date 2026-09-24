/// <reference types="cypress" />

/**
 * REQ-043 — "to the bottom of every page in the footer, put a link to 'terms
 * of service' and then link it to html that renders something like this".
 *
 * Drives one page per shell family, scrolls to the bottom, and asserts the
 * footer's Terms of Service link is visible there; then follows it to /terms
 * and reads the three documents.
 */
describe("REQ-043 footer Terms of Service link on every page", () => {
  const PHONE = "+15125550932";

  /** Scroll whatever scrolls on this page to its bottom: the fixed
   *  .verify-shell (login/contact/verify) scrolls internally; everything else
   *  is the document. */
  function assertFooterLink(scroller: string | null = null) {
    if (scroller) cy.get(scroller).scrollTo("bottom", { ensureScrollable: false });
    else cy.scrollTo("bottom", { ensureScrollable: false });
    cy.get("a[data-terms-link]")
      .should("be.visible")
      .and("have.attr", "href", "/terms")
      .and("contain.text", "Terms of Service");
  }

  describe("REQ-043 every page family shows the Terms of Service link at the bottom of the page", () => {
    beforeEach(() => {
      cy.clearCookies();
      // The public pages are Spanish-first by product decision; the persisted
      // pm_lang choice is what asks for the English label these pins read.
      cy.setCookie("pm_lang", "en");
    });

    it("REQ-043 the root landing", () => {
      cy.visit("/?lang=en");
      assertFooterLink();
    });
    it("REQ-043 the promo landing", () => {
      cy.visit("/landing?lang=en");
      assertFooterLink();
    });
    it("REQ-043 the login card", () => {
      cy.visit("/login");
      assertFooterLink(".verify-shell");
    });
    it("REQ-043 the contact page", () => {
      cy.visit("/contact");
      assertFooterLink(".verify-shell");
    });
    it("REQ-043 the branded 404", () => {
      cy.visit("/nope-req-043", { failOnStatusCode: false });
      assertFooterLink();
    });

    it("REQ-043 the dashboard shell (bottom of the scrolling content)", () => {
      cy.loginAs(PHONE);
      cy.request("POST", "/api/me/onboarded", { skipped: true });
      cy.visit("/dashboard");
      cy.get(".content").scrollTo("bottom", { ensureScrollable: false });
      cy.get(".content a[data-terms-link]").should("be.visible").and("have.attr", "href", "/terms");
    });
    it("REQ-043 the quotes page", () => {
      cy.loginAs(PHONE);
      cy.request("POST", "/api/me/onboarded", { skipped: true });
      cy.visit("/quotes");
      cy.get(".content").scrollTo("bottom", { ensureScrollable: false });
      cy.get(".content a[data-terms-link]").should("be.visible");
    });
    it("REQ-043 the assistant page", () => {
      cy.loginAs(PHONE);
      cy.request("POST", "/api/me/onboarded", { skipped: true });
      cy.visit("/assistant");
      cy.get("a[data-terms-link]").should("be.visible").and("have.attr", "href", "/terms");
    });

    it("REQ-043 the public agreement (/q)", () => {
      cy.loginAs(PHONE);
      cy.request("POST", "/api/me/onboarded", { skipped: true });
      cy.apiCreateCustomer({
        name: "Terms Customer",
        email: "terms.customer@blackhole.postmarkapp.com",
        phoneNumber: "+15125550933",
      }).then((customerId) => {
        cy.apiCreateQuote({
          customerId,
          summary: "Fence repair",
          jobName: "Fence Repair",
          description: "Repair the back fence",
          lineItems: [{ description: "Repair", quantity: 1, unit: "job", price: 20000 }],
          estimatedTotal: 20000,
        }).then((quoteId) => {
          cy.clearCookies();
          cy.visit(`/q/${quoteId}`);
          assertFooterLink();
        });
      });
    });
  });

  it("REQ-043 clicking the footer link opens /terms with all three documents", () => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "en");
    cy.visit("/login");
    cy.get(".verify-shell").scrollTo("bottom", { ensureScrollable: false });
    cy.get("a[data-terms-link]").click();
    cy.location("pathname").should("eq", "/terms");
    cy.contains("h1", "Terms of Service").should("be.visible");
    cy.contains("Effective Date: September 24, 2026").should("be.visible");
    cy.contains(
      "THIS AGREEMENT IS SUBJECT TO ARBITRATION PURSUANT TO THE SOUTH CAROLINA UNIFORM ARBITRATION ACT.",
    ).should("exist");
    cy.contains("h2", "1. Business-to-Business Service").should("exist");
    cy.contains("h2", "31. Contact Us").should("exist");
    cy.get("#refunds").within(() => {
      cy.contains("h1", "Refund & Cancellation Policy").should("exist");
      cy.contains("h2", "13. How to Request Help With a Billing Issue").should("exist");
    });
    cy.get("#privacy").within(() => {
      cy.contains("h1", "Privacy Policy").should("exist");
      cy.contains("h2", "18. Contact Us").should("exist");
      cy.contains("li", "create and administer accounts;").should("exist");
    });
    // /terms itself is a page too — it gets the footer link.
    cy.scrollTo("bottom");
    cy.get("a[data-terms-link]").should("be.visible");
  });
});

describe("REQ-043 the terms page shows both languages through its EN/ES toggle", () => {
  it("REQ-043 the terms page shows both languages through its EN/ES toggle", () => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "en");
    cy.visit("/terms");
    cy.contains("h1", "Terms of Service").should("be.visible");
    cy.contains("h2", "1. Business-to-Business Service").should("exist");
    cy.get("a[data-legal-lang=es]").click();
    cy.location("search").should("eq", "?lang=es");
    cy.contains("h1", "Términos de servicio").should("be.visible");
    cy.contains("Fecha de vigencia: 24 de septiembre de 2026").should("be.visible");
    cy.contains("h2", "1. Servicio de empresa a empresa").should("exist");
    cy.get("#refunds").contains("h1", "Política de reembolsos y cancelaciones").should("exist");
    cy.get("#privacy").contains("h2", "18. Contáctenos").should("exist");
    cy.contains("h2", "1. Business-to-Business Service").should("not.exist");
    // The pick persists: a plain /terms visit now stays Spanish.
    cy.visit("/terms");
    cy.contains("h1", "Términos de servicio").should("be.visible");
    cy.get("a[data-legal-lang=en]").click();
    cy.contains("h1", "Terms of Service").should("be.visible");
  });
});
