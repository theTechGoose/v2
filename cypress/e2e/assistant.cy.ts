/// <reference types="cypress" />

/**
 * User story: "I know the price — help me draft a quote."
 *
 * Walks the price-first empty-state path on /assistant:
 *   1. Click the "I know my price, write it up." prompt
 *   2. Type the job details in the composer + submit
 *   3. UI flips to the price-capture screen
 *   4. Enter a price + click Continue
 *   5. App creates the quote and lands the user on the new
 *      assistant thread for it (/assistant/<conversationId>)
 */
describe("assistant — I know the price, help me draft a quote", () => {
  const CONTRACTOR_PHONE = "+15125550100";

  beforeEach(() => {
    cy.clearCookies();
    cy.loginAs(CONTRACTOR_PHONE);
  });

  it("drafts a quote from the price-first empty-state flow", () => {
    cy.step("visit /assistant");
    cy.visit("/assistant");

    cy.step("click 'I know my price, write it up.'");
    cy.contains("button.chat__empty-prompt", "I know my price, write it up.")
      .should("be.visible")
      .click();

    cy.step("type job details + send");
    cy.get("textarea.composer__input", { timeout: 10_000 })
      .should("be.visible")
      .type("Replace 6 fence panels along the south side, haul off old wood.");
    cy.get("button.composer__send").click();

    cy.step("price-capture screen visible");
    cy.get(".chat__price-capture", { timeout: 10_000 }).should("be.visible");
    cy.contains(".chat__price-title", "What's the price?").should("be.visible");

    cy.step("type price into MoneyInput");
    cy.get(".mi").click();
    cy.get(".mi__input").type("1250");

    cy.step("click Continue");
    cy.get("button.chat__price-continue")
      .should("not.be.disabled")
      .click();

    cy.step("assert nav to /assistant/<conversationId>");
    cy.location("pathname", { timeout: 15_000 })
      .should("match", /^\/assistant\/[a-zA-Z0-9_-]+$/);
  });
});
