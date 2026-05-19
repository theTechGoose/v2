/// <reference types="cypress" />

/**
 * Assistant back-button (a.chat__head-btn) — single-step history.
 *
 *  - Before every user-initiated assistant state change, the app pushes
 *    a snapshot of the current view onto a history stack.
 *  - Clicking the back button pops the most recent snapshot and restores
 *    that view. UI state only (no backend revert).
 *  - When the stack is empty the button is not rendered at all.
 *
 * State changes exercised here, in order:
 *   1. Empty state (3 prompts visible)                        — stack empty
 *   2. Click "I know my price, write it up."                  — push → awaiting details
 *   3. Type details + submit                                  — push → price capture
 *   4. Click back                                             — pop  → awaiting details
 *   5. Click back                                             — pop  → empty state
 *   6. Stack is empty again                                   — button gone
 */
describe("assistant — back button (chat__head-btn)", () => {
  const CONTRACTOR_PHONE = "+15125550111";

  beforeEach(() => {
    cy.clearCookies();
    cy.loginAs(CONTRACTOR_PHONE);
    cy.visit("/assistant");
  });

  it("is hidden on a fresh assistant view (empty history stack)", () => {
    cy.contains("button.chat__empty-prompt", "I know my price, write it up.")
      .should("be.visible");

    cy.get("a.chat__head-btn").should("not.exist");
  });

  it("appears after a state change and reverts the latest change on click", () => {
    // --- State change #1: open the details-first flow ------------------------
    cy.contains("button.chat__empty-prompt", "I know my price, write it up.")
      .click();
    cy.contains(".chat__details-prompt-bubble", /tell me the job details/i)
      .should("be.visible");

    // Back button is now in the DOM (history depth = 1).
    cy.get("a.chat__head-btn").should("be.visible");

    // Click back → state restored to the empty-state prompts.
    cy.get("a.chat__head-btn").click();
    cy.contains("button.chat__empty-prompt", "I know my price, write it up.")
      .should("be.visible");
    cy.get(".chat__details-prompt-bubble").should("not.exist");

    // Stack is empty again → button is gone.
    cy.get("a.chat__head-btn").should("not.exist");
  });

  it("steps back one change at a time across multiple changes", () => {
    // Change #1: empty state → awaiting details
    cy.contains("button.chat__empty-prompt", "I know my price, write it up.")
      .click();
    cy.contains(".chat__details-prompt-bubble", /tell me the job details/i)
      .should("be.visible");

    // Change #2: type details + submit → price capture
    cy.get("textarea.composer__input")
      .should("be.visible")
      .type("Replace 6 fence panels along the south side.");
    cy.get("button.composer__send").click();
    cy.get(".chat__price-capture", { timeout: 10_000 }).should("be.visible");

    // First click back → previous (awaiting details, no submitted bubble).
    cy.get("a.chat__head-btn").click();
    cy.contains(".chat__details-prompt-bubble", /tell me the job details/i)
      .should("be.visible");
    cy.get(".chat__price-capture").should("not.exist");

    // Second click back → empty state, three prompts.
    cy.get("a.chat__head-btn").click();
    cy.contains("button.chat__empty-prompt", "I know my price, write it up.")
      .should("be.visible");
    cy.get(".chat__details-prompt-bubble").should("not.exist");

    // No more history → button hidden.
    cy.get("a.chat__head-btn").should("not.exist");
  });
});
