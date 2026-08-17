/// <reference types="cypress" />

/**
 * PDF p16 — build out "I know the job, help me price it.":
 *   1. First screen is Job Details, then it asks any questions needed
 *   2. Next screen confirms the details
 *   3. Then it gives THREE pricing options and a FOURTH custom one
 *   4. Then it continues through the rest of the standard steps
 *
 * PDF p17 — "Just give me a quick quote." is an OPEN product question
 * ("not sure how this is any different") — pinned as a skipped placeholder,
 * not an invented spec.
 *
 * Contract selectors: [data-cy=confirm-details], [data-cy=pricing-option],
 * [data-cy=pricing-option-custom].
 */
describe("assistant — I know the job, help me price it", () => {
  const PHONE = "+15125550923";
  const DETAILS = "Replace 6 fence panels along the south side";

  beforeEach(() => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "en"); // re-pin EN after the wipe (Spanish-first app)
    cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "en" }); // fresh users default to es; EN copy asserted
    cy.request("POST", "/api/me/onboarded", { skipped: true }); // skip the /welcome trap for fresh users
    cy.visit("/assistant");
    cy.contains("button.chat__empty-prompt", "I know the job, help me price it.")
      .should("be.visible")
      .click();
  });

  it("starts with the Job Details screen", () => {
    cy.contains(/job details|tell me the job/i, { timeout: 10_000 })
      .should("be.visible");
    cy.get("textarea.composer__input").should("be.visible");
  });

  it("asks any follow-up questions, then shows a confirm-details screen", () => {
    cy.get("textarea.composer__input").type(DETAILS);
    cy.get("button.composer__send").click();

    // Whatever follow-ups the assistant asks, answering must eventually land
    // on an explicit confirmation of the collected details.
    cy.get("[data-cy=confirm-details]", { timeout: 20_000 }).should("be.visible");
    cy.get("[data-cy=confirm-details]").should("contain.text", "fence");
  });

  it("after confirmation it offers exactly three pricing options plus a custom fourth", () => {
    cy.get("textarea.composer__input").type(DETAILS);
    cy.get("button.composer__send").click();
    cy.get("[data-cy=confirm-details]", { timeout: 20_000 }).should("be.visible").click();

    cy.get("[data-cy=pricing-option]", { timeout: 20_000 }).should("have.length", 3);
    cy.get("[data-cy=pricing-option-custom]").should("be.visible");
  });

  it("picking a suggested price continues into the standard steps", () => {
    cy.get("textarea.composer__input").type(DETAILS);
    cy.get("button.composer__send").click();
    cy.get("[data-cy=confirm-details]", { timeout: 20_000 }).should("be.visible").click();
    cy.get("[data-cy=pricing-option]", { timeout: 20_000 }).first().click();

    // The flow proceeds like "I know my price": customer step next.
    cy.contains(/who is this for/i, { timeout: 15_000 }).should("be.visible");
  });

  it("the custom option lets the contractor type their own price and continue", () => {
    cy.get("textarea.composer__input").type(DETAILS);
    cy.get("button.composer__send").click();
    cy.get("[data-cy=confirm-details]", { timeout: 20_000 }).should("be.visible").click();
    cy.get("[data-cy=pricing-option-custom]", { timeout: 20_000 }).click();
    cy.focused().type("725{enter}");

    cy.contains(/who is this for/i, { timeout: 15_000 }).should("be.visible");
  });
});

describe("assistant — Just give me a quick quote", () => {
  // PDF p17: the product decision is open — "We need to see how this option
  // could work". Do not invent behavior; unskip once the flow is decided.
  it.skip("[DECIDE p17] quick-quote flow is distinct from 'I know my price, write it up.'", () => {
    // Intentionally unimplemented.
  });
});
