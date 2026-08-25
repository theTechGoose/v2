/// <reference types="cypress" />

/**
 * Assistant universal back button (a.chat__head-btn).
 *
 *  - The header back button is ALWAYS rendered (ChatHeaderLive). Clicking it
 *    dispatches `pm:asst-back`; AsstChat resolves what "back" means,
 *    most-immediate action first:
 *      1. an active wizard step (stepIdx > 0) → rewind one step
 *      2. an in-chat view on the history stack  → pop + restore that view
 *      3. nothing left                          → leave for /dashboard
 *  - Before every user-initiated assistant state change, the app pushes a
 *    snapshot of the current view onto the history stack. Restores are UI
 *    state only (no backend revert).
 *
 * State changes exercised here, in order:
 *   1. Empty state (3 prompts visible)                        — stack empty
 *   2. Click "I know my price, write it up."                  — push → awaiting details
 *   3. Type details + submit                                  — push → price capture
 *   4. Click back                                             — pop  → awaiting details
 *   5. Click back                                             — pop  → empty state
 *   6. Click back on the empty stack                          — exit → /dashboard
 */
describe("assistant — back button (chat__head-btn)", () => {
  const CONTRACTOR_PHONE = "+15125550111";

  beforeEach(() => {
    cy.clearCookies();
    cy.loginAs(CONTRACTOR_PHONE);
    // This spec asserts the ENGLISH empty-state prompts. A fresh master-OTP
    // user seeds Spanish-first (language:"es"), so pin the language rather
    // than depend on residual dev-KV state (harness convention: specs that
    // want Spanish PUT language:"es").
    cy.request("PUT", "/api/me", { language: "en" });
    cy.visit("/assistant");
  });

  it("is always visible; on a fresh view (empty stack) it exits to the dashboard", () => {
    cy.contains("button.chat__empty-prompt", "I know my price, write it up.")
      .should("be.visible");

    // Universal back button is rendered even with no history.
    cy.get("a.chat__head-btn").should("be.visible");

    // Nothing to rewind or pop → back leaves the chat for the dashboard.
    cy.get("a.chat__head-btn").click();
    cy.location("pathname").should("eq", "/dashboard");
  });

  it("reverts the latest change on click, then exits once the stack is empty", () => {
    // --- State change #1: open the details-first flow ------------------------
    cy.contains("button.chat__empty-prompt", "I know my price, write it up.")
      .click();
    cy.contains(".chat__details-prompt-bubble", /tell me the job details/i)
      .should("be.visible");

    // History depth = 1 → click back restores the empty-state prompts.
    cy.get("a.chat__head-btn").click();
    cy.contains("button.chat__empty-prompt", "I know my price, write it up.")
      .should("be.visible");
    cy.get(".chat__details-prompt-bubble").should("not.exist");

    // Stack is empty again, but the button stays; one more click exits.
    cy.get("a.chat__head-btn").should("be.visible").click();
    cy.location("pathname").should("eq", "/dashboard");
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

    // No more history → the button remains and now exits to the dashboard.
    cy.get("a.chat__head-btn").should("be.visible").click();
    cy.location("pathname").should("eq", "/dashboard");
  });
});
