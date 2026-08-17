/// <reference types="cypress" />

/**
 * PDF p6 (Invoice Edits) — the invoice document in the UI must:
 *   - show all the quote's information (job name, details, line items, total)
 *   - NOT show the numbered Terms list
 *   - NOT show a signature block
 *   - link to the signed quote when one exists
 *   - be editable
 *
 * Contract selectors: [data-cy=invoice-signed-quote-link], [data-cy=invoice-edit].
 */
describe("invoice — parity with the quote, minus terms and signatures", () => {
  const PHONE = "+15125550931";
  let ids: { quoteId: string; contractId: string; invoiceId: string };

  before(() => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "en");
    cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "en" }); // fresh users default to es; EN copy asserted
    cy.seedQuoteToCash({
      quote: {
        jobName: "Backyard Junk Removal",
        description: "Removing junk from a backyard and making sure no trash remains",
      },
    }).then((seeded) => {
      ids = seeded;
      // Sign the contract so the signed-quote link case is real.
      cy.apiSignContract(ids.contractId, {
        signature: "Green Goblin",
        name: "Green Goblin",
      });
    });
  });

  beforeEach(() => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "en"); // re-pin EN after the wipe (Spanish-first app)
  });

  it("public invoice shows the quote's info: job name, details, line items, total", () => {
    cy.visit(`/i/${ids.invoiceId}`);
    cy.contains(/backyard junk removal/i, { timeout: 10_000 }).should("be.visible");
    cy.contains(/no trash remains/i).should("be.visible");
    cy.contains(/\$\s?\d/).should("be.visible");
  });

  it("public invoice has NO terms section and NO signature block (either language)", () => {
    cy.visit(`/i/${ids.invoiceId}`);
    // Anchor on the rendered document first so the negatives can't pass
    // against a blank/error page.
    cy.get("[data-cy=invoice-doc]", { timeout: 10_000 })
      .should("be.visible")
      .and("contain.text", "Backyard Junk Removal")
      .within(() => {
        cy.contains(/terms|términos/i).should("not.exist");
        cy.contains(/sign here|signature|firma/i).should("not.exist");
      });
  });

  it("public invoice links to the signed quote (p6: 'include a link to the signed quote if one exists')", () => {
    cy.visit(`/i/${ids.invoiceId}`);
    cy.get("[data-cy=invoice-signed-quote-link]", { timeout: 10_000 })
      .should("be.visible")
      .and("have.attr", "href")
      .and("match", new RegExp(ids.contractId.slice(0, 8)));
  });

  it("the contractor can edit the invoice from its detail view", () => {
    cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "en" }); // fresh users default to es; EN copy asserted
    cy.visit(`/invoices?open=${ids.invoiceId}`);
    cy.get("[data-cy=invoice-edit]", { timeout: 10_000 }).should("be.visible").click();
    // An editable surface appears (line items / total inputs).
    cy.get("input, textarea").filter(":visible").should("have.length.greaterThan", 0);
  });
});
