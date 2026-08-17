/// <reference types="cypress" />

/**
 * PDF p2, p3, p7, p8 — wizard step navigation.
 *
 *  p2/p8: every step of the quote tasks needs a Go Back control so earlier
 *         answers — Job Details above all — can be edited, with the typed
 *         content preserved.
 *  p3:    once the flow has produced the invoice (terminal stage), Go Back
 *         exits to the Dashboard.
 *  p7:    the "Who is this for?" step must also collect a Business Name.
 *
 * Contract selectors (green phase must add): [data-cy=wizard-back],
 * [data-cy=wizard-business-name].
 */
describe("quote wizard — back navigation through the steps", () => {
  const PHONE = "+15125550921";

  beforeEach(() => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "en"); // re-pin EN after the wipe (Spanish-first app)
    cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "en" }); // fresh users default to es; EN copy asserted
    cy.request("POST", "/api/me/onboarded", { skipped: true }); // skip the /welcome trap for fresh users
    cy.visit("/assistant");
    cy.contains("button.chat__empty-prompt", "I know my price, write it up.").click();
    cy.contains(".chat__details-prompt-bubble", /tell me the job details/i)
      .should("be.visible");
  });

  function submitDetails(text: string) {
    cy.get("textarea.composer__input").should("be.visible").type(text);
    cy.get("button.composer__send").click();
  }

  it("every step after job details shows a Go Back control", () => {
    submitDetails("Remove old toilet, install new toilet, test for leaks");
    cy.get(".chat__price-capture", { timeout: 10_000 }).should("be.visible");

    // Price step must expose a step-level back control.
    cy.get("[data-cy=wizard-back]").should("be.visible");
  });

  it("going back to Job Details restores the typed content for editing (p2)", () => {
    const details = "Remove old toilet, install new toilet, test for leaks";
    submitDetails(details);
    cy.get(".chat__price-capture", { timeout: 10_000 }).should("be.visible");

    cy.get("[data-cy=wizard-back]").click();

    // The job-details step is back AND still holds what was typed — editable,
    // not blanked.
    cy.get("textarea.composer__input")
      .should("be.visible")
      .invoke("val")
      .should("contain", "Remove old toilet");
  });

  it("edits made after going back flow into the regenerated quote", () => {
    submitDetails("Remove old toilet, install new toilet");
    cy.get(".chat__price-capture", { timeout: 10_000 }).should("be.visible");

    cy.get("[data-cy=wizard-back]").click();
    cy.get("textarea.composer__input").should("be.visible")
      .type(", also test for leaks");
    cy.get("button.composer__send").click();

    cy.get(".chat__price-capture", { timeout: 10_000 }).should("be.visible");
    cy.contains(/test for leaks/i).should("exist");
  });

  it("the 'Who is this for?' step collects a Business Name (p7)", () => {
    submitDetails("Remove old toilet, install new toilet, test for leaks");
    cy.get(".chat__price-capture", { timeout: 10_000 }).should("be.visible");
    // Enter a price to advance to the customer step.
    cy.get(".chat__price-capture input").first().type("500{enter}");

    cy.contains(/who is this for/i, { timeout: 10_000 }).should("be.visible");
    cy.get("[data-cy=wizard-business-name]").should("be.visible");

    // It is optional: leaving it empty must not block Next.
    cy.get("[data-cy=wizard-business-name]").should("not.have.attr", "required");
  });

  it("at the invoice stage the universal back exits to the Dashboard, not into the finished flow (p3)", () => {
    // Drive the flow far enough that the conversation reaches its terminal
    // (invoice-produced) stage, then press the assistant's universal back.
    // The contract (AsstChat pm:asst-back): once the flow is terminal there
    // is nothing left to rewind or pop → back leaves for /dashboard.
    submitDetails("Remove old toilet, install new toilet, test for leaks");
    cy.get(".chat__price-capture", { timeout: 10_000 }).should("be.visible");
    cy.get(".chat__price-capture input").first().type("500{enter}");
    cy.contains(/who is this for/i, { timeout: 10_000 }).should("be.visible");

    // Mark the conversation terminal via the API seam the UI uses, then
    // reload the same conversation view.
    cy.location("search").then(() => {
      cy.request("/api/agents/conversations").then(({ body }) => {
        const conv = (Array.isArray(body) ? body : body.items ?? [])[0];
        expect(conv, "active conversation").to.exist;
        cy.request({
          method: "POST",
          url: `/api/agents/conversations/${conv.id}/send-invoice`,
          failOnStatusCode: false,
        });
        cy.visit(`/assistant?c=${conv.id}`);
      });
    });

    cy.get("a.chat__head-btn").should("be.visible").click();
    cy.location("pathname").should("eq", "/dashboard");
  });
});
