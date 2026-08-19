/// <reference types="cypress" />

/**
 * RED (TDD) — ONE back button in the assistant, and it UNDOES.
 *
 * User-reported (2026-08-19):
 *  1. "in my assistant there should ONLY be a single back button" — the
 *     chat-header control (a.chat__head-btn). "no widget or chat message
 *     should contain a back button" — every step card today renders its own
 *     [data-cy=wizard-back]; those must be gone.
 *  2. "it should undo the previous action, not behave as a second browser
 *     back button" — reproduced live: on the quote + agreement preview
 *     (.quote-review) the header back exits to /dashboard instead of
 *     undoing (closing the preview back to the thread).
 *
 * Drive: the deterministic dev seed (/assistant?dev → .chat__empty-debug-btn,
 * the ux-send-moment recipe) — quote → conversation → terms wizard →
 * customer step → 4 option picks → .quote-review.
 *
 * Phones (inside the ux-* wipe range 6000-6699): +15125556250 contractor,
 * +15125556251 customer.
 */

const UXSB_PHONE = "+15125556250";
const UXSB_CUSTOMER_PHONE = "+15125556251";

function uxsbLogin() {
  cy.clearCookies();
  cy.setCookie("pm_lang", "en");
  cy.loginAs(UXSB_PHONE);
  cy.apiUpdateUser({ language: "en", name: "Solo Back Contractor" });
  cy.request("POST", "/api/me/onboarded", { skipped: true });
}

/** Exactly one back control on the page: the header one. */
function assertSingleBackControl() {
  cy.get("a.chat__head-btn").should("have.length", 1).and("be.visible");
  cy.get("[data-cy=wizard-back]").should("not.exist");
}

describe("assistant — a single undo-style back button", () => {
  beforeEach(() => {
    cy.viewport(1280, 800);
    uxsbLogin();
  });

  it("no widget/chat-message back buttons anywhere on the details-first path", () => {
    cy.visit("/assistant");
    cy.contains("button.chat__empty-prompt", "I know my price, write it up.")
      .should("be.visible");
    assertSingleBackControl(); // empty state

    cy.contains("button.chat__empty-prompt", "I know my price, write it up.")
      .click();
    cy.contains(".chat__details-prompt-bubble", /tell me the job details/i)
      .should("be.visible");
    assertSingleBackControl(); // awaiting details

    cy.get("textarea.composer__input")
      .should("be.visible")
      .type("Paint a 50ft wooden fence, $500 total.");
    cy.get("button.composer__send").click();
    cy.get(".chat__price-capture", { timeout: 10_000 }).should("be.visible");
    assertSingleBackControl(); // price capture — today renders [data-cy=wizard-back]
  });

  it("the single header back UNDOES through the seeded wizard and closes the preview — never a dashboard exit while surfaces remain", () => {
    cy.visit("/assistant?dev");
    cy.get(".chat__empty-debug-btn", { timeout: 10_000 })
      .should("be.visible")
      .click();
    cy.location("pathname", { timeout: 20_000 })
      .should("match", /^\/assistant\/[A-Za-z0-9-]+$/);

    // Customer step (a wizard message) — no in-card back button.
    cy.openCustomerCreateForm();
    cy.get(".cust-create input.cust-pick__search", { timeout: 20_000 })
      .first()
      .type("Solo Back Customer");
    assertSingleBackControl();
    cy.get(".cust-create input[type=tel]").type(UXSB_CUSTOMER_PHONE);
    cy.get(".cust-create__btn--primary").should("not.be.disabled").click();

    // Every remaining wizard step: options only, no in-card back button.
    const pickFirstOption = () => {
      cy.get(".wiz__opts .wiz-opt:not(.wiz-opt--custom)", { timeout: 15_000 })
        .filter(":visible")
        .first()
        .click();
    };
    pickFirstOption(); // start_date
    assertSingleBackControl();
    pickFirstOption(); // duration
    pickFirstOption(); // payment_terms
    pickFirstOption(); // warranty

    // The quote + agreement preview opens.
    cy.get(".quote-review", { timeout: 20_000 }).should("be.visible");
    assertSingleBackControl();

    // THE reported bug: back on the preview must UNDO (close the preview,
    // stay on the conversation) — not exit to /dashboard.
    cy.get("a.chat__head-btn").click();
    cy.get(".quote-review").should("not.exist");
    cy.location("pathname").should("match", /^\/assistant\/[A-Za-z0-9-]+$/);
  });
});
