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
    cy.get("a[data-legal-footer-link]")
      .should("be.visible")
      .and("have.attr", "href", "/terms")
      .and("contain.text", "Terms & Policies");
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

  it("REQ-043 clicking the footer link opens /terms — its own page (REQ-066), the October 6 text (REQ-065)", () => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "en");
    cy.visit("/login");
    cy.get(".verify-shell").scrollTo("bottom", { ensureScrollable: false });
    cy.get("a[data-terms-link]").click();
    cy.location("pathname").should("eq", "/terms");
    cy.contains("h1", "Terms of Service").should("be.visible");
    cy.contains("Last Updated: October 6, 2026").should("be.visible");
    cy.contains(
      "THIS AGREEMENT IS SUBJECT TO ARBITRATION PURSUANT TO THE SOUTH CAROLINA UNIFORM ARBITRATION ACT.",
    ).should("exist");
    cy.contains("h2", "1. Business-to-Business Service").should("exist");
    cy.contains("h2", "31. Contact Us").should("exist");
    // the website's header, and the four documents as tabs
    cy.get(".nav-wrap .brand").should("be.visible");
    cy.get("[data-legal-nav] a").should("have.length", 4);
    cy.get("[data-legal-nav] a[aria-current=page]").should("have.attr", "href", "/terms");
    // the other documents are their own pages
    cy.get("[data-legal-nav] a[data-legal-link=refunds]").click();
    cy.location("pathname").should("eq", "/refund-policy");
    cy.contains("h1", "Refund & Cancellation Policy").should("be.visible");
    cy.contains("h2", "13. How to Request Help With a Billing Issue").should("exist");
    cy.get("[data-legal-nav] a[data-legal-link=privacy]").click();
    cy.location("pathname").should("eq", "/privacy");
    cy.contains("h1", "Privacy Policy").should("be.visible");
    cy.contains("h2", "18. Contact Us").should("exist");
    cy.contains("li", "create and administer accounts;").should("exist");
    cy.get("[data-legal-nav] a[data-legal-link=sms]").click();
    cy.location("pathname").should("eq", "/sms-terms");
    cy.contains("h1", "SMS Terms & Conditions").should("be.visible");
    cy.contains("h2", "5. Message Frequency, Charges, STOP, and HELP").should("exist");
    // a legal page is a page too — it gets the footer's policies link.
    cy.scrollTo("bottom");
    cy.get("[data-site-footer] a[data-legal-footer-link]").should("have.length", 1);
  });
});

describe("REQ-043 the legal pages show both languages through the header's toggle", () => {
  it("REQ-043 the legal pages show both languages through the header's toggle", () => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "en");
    cy.visit("/terms");
    cy.contains("h1", "Terms of Service").should("be.visible");
    cy.contains("h2", "1. Business-to-Business Service").should("exist");
    cy.get("a[data-legal-lang=es]").click();
    cy.location("search").should("eq", "?lang=es");
    cy.contains("h1", "Términos de servicio").should("be.visible");
    cy.contains("Última actualización: 6 de octubre de 2026").should("be.visible");
    cy.contains("h2", "1. Servicio de empresa a empresa").should("exist");
    cy.contains("h2", "1. Business-to-Business Service").should("not.exist");
    // The pick persists: a plain visit to another legal page stays Spanish.
    cy.visit("/sms-terms");
    cy.contains("h1", "Términos y condiciones de SMS").should("be.visible");
    cy.get("a[data-legal-lang=en]").click();
    cy.contains("h1", "SMS Terms & Conditions").should("be.visible");
  });
});
