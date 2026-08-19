/// <reference types="cypress" />

/**
 * Wizard step navigation — SINGLE back button contract (2026-08-19).
 *
 * Supersedes the old roadmap p2/p8 per-step [data-cy=wizard-back] controls:
 * the assistant now renders exactly ONE back control, the chat header's
 * a.chat__head-btn, and it UNDOES the previous action via the shared
 * resolver (shared/quote-flow/assistant-back.ts). The BEHAVIOR the roadmap
 * wanted is unchanged and asserted here:
 *  - earlier answers stay editable: backing into Job Details restores the
 *    typed content (p2), and edits flow into the regenerated quote;
 *  - the "Who is this for?" step collects a Business Name (p7);
 *  - at the terminal (invoice-produced) stage back exits to /dashboard (p3).
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

  it("steps render NO in-widget back control — the header back is the single one", () => {
    submitDetails("Remove old toilet, install new toilet, test for leaks");
    cy.get(".chat__price-capture", { timeout: 10_000 }).should("be.visible");

    cy.get("[data-cy=wizard-back]").should("not.exist");
    cy.get("a.chat__head-btn").should("have.length", 1).and("be.visible");
  });

  it("going back to Job Details restores the typed content for editing (p2)", () => {
    const details = "Remove old toilet, install new toilet, test for leaks";
    submitDetails(details);
    cy.get(".chat__price-capture", { timeout: 10_000 }).should("be.visible");

    cy.get("a.chat__head-btn").click();

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

    cy.get("a.chat__head-btn").click();
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
