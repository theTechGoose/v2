/// <reference types="cypress" />

/**
 * PDF p11 — "When selecting Copy Link from this page it is not the full
 * Quote. It is a simple version of it."
 *
 * The copied link must land the customer on the SAME full quote document
 * that "View as client" shows: job details, line items/description, terms,
 * total, and the accept/sign call-to-action.
 */
describe("quote card — Copy link must give the FULL quote", () => {
  const PHONE = "+15125550926";
  let quoteId: string;

  before(() => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "en");
    cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "en" }); // fresh users default to es; EN copy asserted
    cy.apiCreateCustomer({
      name: "Green Goblin",
      email: "green.copy@blackhole.postmarkapp.com",
      phoneNumber: "+15125550927",
    }).then((customerId) => {
      cy.apiCreateQuote({
        customerId,
        summary: "Removing junk from a backyard",
        jobName: "Backyard Junk Removal",
        description:
          "Removing junk from a backyard and making sure no trash remains",
        lineItems: [{
          description: "Junk removal",
          quantity: 1,
          unit: "job",
          price: 55000,
        }],
        estimatedTotal: 55000,
      }).then((id) => {
        quoteId = id;
        cy.apiSendQuoteEmail(quoteId);
      });
    });
  });

  beforeEach(() => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "en"); // re-pin EN after the wipe (Spanish-first app)
    cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "en" }); // fresh users default to es; EN copy asserted
  });

  function copiedLink(): Cypress.Chainable<string> {
    cy.visit(`/quotes?open=${quoteId}`, {
      onBeforeLoad(win) {
        // Capture clipboard writes without OS clipboard permissions.
        Object.defineProperty(win.navigator, "clipboard", {
          value: {
            writeText: (text: string) => {
              (win as unknown as { __copied?: string }).__copied = text;
              return Promise.resolve();
            },
          },
          configurable: true,
        });
      },
    });
    cy.contains("button, a", /copy link/i, { timeout: 10_000 }).click();
    return cy.window().its("__copied");
  }

  it("the copied URL renders the full quote document, not a simplified version", () => {
    copiedLink().then((link) => {
      expect(link, "copied link").to.be.a("string").and.not.be.empty;
      cy.clearCookies(); // view it as the customer would
      cy.setCookie("pm_lang", "en");
      cy.visit(link);

      // Full quote anatomy:
      cy.contains(/backyard junk removal/i).should("be.visible"); // job name
      cy.contains(/no trash remains/i).should("be.visible"); // full job details
      cy.contains(/\$?550(\.00)?/).should("be.visible"); // total
      // The signature ceremony (the merged doc's accept affordance): the
      // PublicSignQuote pad + its submit ("Type your name to enable" until
      // a name is typed, then "Sign the agreement →").
      cy.get("form.ctr__sign-form").should("be.visible");
      cy.contains("button", /type your name|sign the agreement/i)
        .should("be.visible");
    });
  });

  it("copy-link and View-as-client land on the same document", () => {
    copiedLink().then((link) => {
      cy.contains("button, a", /view as client/i).invoke("attr", "href").then(
        (href) => {
          // Same route target (short link may redirect — follow it via request).
          cy.request({ url: link, followRedirect: true }).then((resp) => {
            const finalUrl = resp.redirects?.length
              ? resp.redirects[resp.redirects.length - 1].replace(/^\d+: /, "")
              : link;
            expect(finalUrl).to.include(quoteId.slice(0, 8));
            expect(href, "view-as-client href").to.include(quoteId.slice(0, 8));
          });
        },
      );
    });
  });
});
