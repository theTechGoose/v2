/// <reference types="cypress" />

/**
 * REQ-044 — "change the number everywhere on the site to 855-362-8666. add
 * the phone number to the footer on every page as well as the address."
 *
 * Drives one page per shell family, scrolls to the bottom, and asserts the
 * footer shows a tel: link to 855-362-8666 and the mailing address; then
 * checks the other places the number is printed (landing hero, contact page,
 * dashboard "Call support" CTA) dial the new number.
 */
const PHONE_DISPLAY = "855-362-8666";
const PHONE_HREF = "tel:+18553628666";
const ADDRESS = "4505 Socastee Blvd, Myrtle Beach, SC 29588";

describe("REQ-044 footer phone + address on every page", () => {
  const PHONE = "+15125550942";

  /** Scroll whatever scrolls on this page to its bottom (the fixed
   *  .verify-shell on login/contact scrolls internally; the app shell's
   *  .content scrolls; everything else is the document), then assert the
   *  footer's phone link and address are visible there. */
  function assertFooterContact(scroller: string | null = null) {
    if (scroller) cy.get(scroller).scrollTo("bottom", { ensureScrollable: false });
    else cy.scrollTo("bottom", { ensureScrollable: false });
    const within = scroller ? `${scroller} ` : "";
    cy.get(`${within}footer a[data-site-phone]`)
      .should("be.visible")
      .and("have.attr", "href", PHONE_HREF)
      .and("contain.text", PHONE_DISPLAY);
    cy.get(`${within}footer [data-site-address]`)
      .should("be.visible")
      .and("contain.text", ADDRESS);
  }

  function loginOnboarded() {
    cy.loginAs(PHONE);
    cy.request("POST", "/api/me/onboarded", { skipped: true });
  }

  describe("REQ-044 every page family shows the phone and the address at the bottom of the page", () => {
    beforeEach(() => {
      cy.clearCookies();
      cy.setCookie("pm_lang", "en");
    });

    it("REQ-044 the root landing", () => {
      cy.visit("/?lang=en");
      assertFooterContact();
    });
    it("REQ-044 the promo landing", () => {
      cy.visit("/landing?lang=en");
      assertFooterContact();
    });
    it("REQ-044 the login card", () => {
      cy.visit("/login");
      assertFooterContact(".verify-shell");
    });
    it("REQ-044 the contact page", () => {
      cy.visit("/contact");
      assertFooterContact(".verify-shell");
    });
    it("REQ-044 the terms page", () => {
      cy.visit("/terms");
      assertFooterContact();
    });
    it("REQ-044 the branded 404", () => {
      cy.visit("/nope-req-044", { failOnStatusCode: false });
      assertFooterContact();
    });
    it("REQ-044 the dashboard shell (bottom of the scrolling content)", () => {
      loginOnboarded();
      cy.visit("/dashboard");
      assertFooterContact(".content");
    });
    it("REQ-044 the quotes page", () => {
      loginOnboarded();
      cy.visit("/quotes");
      assertFooterContact(".content");
    });
    it("REQ-044 the assistant page (desktop)", () => {
      loginOnboarded();
      cy.visit("/assistant");
      cy.get("footer a[data-site-phone]").should("be.visible").and("have.attr", "href", PHONE_HREF);
      cy.get("footer [data-site-address]").should("be.visible").and("contain.text", ADDRESS);
    });
    it("REQ-044 the assistant page (390px mobile — the footer wraps and is not clipped)", () => {
      cy.viewport(390, 844);
      loginOnboarded();
      cy.visit("/assistant");
      cy.get("footer a[data-site-phone]").should("be.visible").and("contain.text", PHONE_DISPLAY);
      cy.get("footer [data-site-address]").should("be.visible").and("contain.text", ADDRESS);
    });
    it("REQ-044 the public agreement (/q)", () => {
      loginOnboarded();
      cy.apiCreateCustomer({
        name: "Footer Customer",
        email: "footer.customer@blackhole.postmarkapp.com",
        phoneNumber: "+15125550943",
      }).then((customerId) => {
        cy.apiCreateQuote({
          customerId,
          summary: "Deck repair",
          jobName: "Deck Repair",
          description: "Repair the back deck",
          lineItems: [{ description: "Repair", quantity: 1, unit: "job", price: 20000 }],
          estimatedTotal: 20000,
        }).then((quoteId) => {
          cy.clearCookies();
          cy.visit(`/q/${quoteId}`);
          assertFooterContact();
        });
      });
    });
  });

  describe('REQ-044 the landing hero, the contact page and the dashboard "Call support" CTA dial 855-362-8666', () => {
    beforeEach(() => {
      cy.clearCookies();
      cy.setCookie("pm_lang", "en");
    });

    it("REQ-044 the promo landing hero call-out and custom-plan CTA", () => {
      cy.visit("/landing?lang=en");
      cy.get(".pm-call__num").should("have.attr", "href", PHONE_HREF).and("contain.text", PHONE_DISPLAY);
      cy.get(".pm-plan__cta[href^='tel:']").should("have.attr", "href", PHONE_HREF);
      cy.get("a[href^='tel:']").each(($a) => expect($a.attr("href")).to.eq(PHONE_HREF));
    });
    it("REQ-044 the contact page's call line", () => {
      cy.visit("/contact");
      cy.get("a[href^='tel:']").should("have.length.at.least", 2);
      cy.get("a[href^='tel:']").each(($a) => {
        expect($a.attr("href")).to.eq(PHONE_HREF);
        expect($a.text()).to.contain(PHONE_DISPLAY);
      });
    });
    it('REQ-044 the dashboard "Call support" CTA', () => {
      loginOnboarded();
      cy.visit("/dashboard");
      cy.get(".assistant-cta__call")
        .should("have.attr", "href", PHONE_HREF)
        .and("contain.text", PHONE_DISPLAY);
    });
    it("REQ-044 the old number appears nowhere on the landings", () => {
      for (const path of ["/?lang=en", "/landing?lang=en", "/?lang=es", "/landing?lang=es"]) {
        cy.visit(path);
        cy.get("body").invoke("text").should("not.match", /866[^0-9a-z]{0,3}767[^0-9a-z]{0,3}8399/i);
      }
    });
  });
});
