/// <reference types="cypress" />

/**
 * RED (TDD) — the assistant's customer step must let the user PICK AN
 * EXISTING CUSTOMER, without any in-widget back button.
 *
 * User-reported (2026-08-19): "in the assistant flow I'm not sure it's
 * allowing me to pick an existing customer." Reproduced live: with a saved
 * customer on the account, the "Who is this for?" step opens on the CREATE
 * form (AsstChat.tsx:6634 `preferCreate`) and the pick list hides behind
 * the form's footer "Atrás" — which reads as navigation, not as "choose an
 * existing customer" (and violates the single-back rule).
 *
 * Desired:
 *  - with saved customers the step OPENS on the pick list
 *    (.cust-dd__trigger "Choose an existing customer" + "+ New customer");
 *  - picking the saved customer completes the step (their name lands in
 *    the step summary);
 *  - the create form carries a forward "choose an existing customer"
 *    affordance — never an "Atrás"/"Back" button.
 *
 * Phones (inside the ux-* wipe range 6000-6699): +15125556252 contractor,
 * +15125556253 the saved customer.
 */

const UXPC_PHONE = "+15125556252";
const UXPC_CUSTOMER_PHONE = "+15125556253";
const UXPC_CUSTOMER = "Existing Eddie";

describe("assistant — picking an existing customer", () => {
  beforeEach(() => {
    cy.viewport(1280, 800);
    cy.clearCookies();
    cy.setCookie("pm_lang", "en");
    cy.loginAs(UXPC_PHONE);
    cy.apiUpdateUser({ language: "en", name: "Picker Contractor" });
    cy.request("POST", "/api/me/onboarded", { skipped: true });
    // The saved customer the step must offer (idempotent across retries:
    // duplicate names are fine, the picker matches by name).
    cy.request("POST", "/api/customers", {
      name: UXPC_CUSTOMER,
      phoneNumber: UXPC_CUSTOMER_PHONE,
      email: "existing.eddie@blackhole.postmarkapp.com",
    });
    // Deterministic entry to the terms wizard's customer step.
    cy.visit("/assistant?dev");
    cy.get(".chat__empty-debug-btn", { timeout: 10_000 })
      .should("be.visible")
      .click();
    cy.location("pathname", { timeout: 20_000 })
      .should("match", /^\/assistant\/[A-Za-z0-9-]+$/);
  });

  it("with a saved customer the step OPENS on the pick list and the pick completes the step", () => {
    // RED today: the create form opens instead and no pick affordance shows.
    cy.get(".cust-dd__trigger", { timeout: 20_000 })
      .should("be.visible")
      .and("contain.text", "Choose an existing customer");

    cy.get(".cust-dd__trigger").click();
    cy.get(".cust-pick__search").should("be.visible");
    cy.contains(".cust-pick__row", UXPC_CUSTOMER).click();

    // The step completes with the picked customer bound — their name shows
    // in the answered-step summary, and the wizard moves on
    // (termsWizard.startDate.question, lang/en.json).
    cy.contains(UXPC_CUSTOMER, { timeout: 15_000 }).should("be.visible");
    cy.contains(/when does the job start/i, { timeout: 15_000 })
      .should("be.visible");
  });

  it("the create form offers 'choose an existing customer' — never a Back button", () => {
    // Open the create form from the list.
    cy.contains("button", "+ New customer", { timeout: 20_000 }).click();
    cy.get(".cust-create").should("be.visible");

    // No back control inside the widget (single-back rule)…
    cy.get(".cust-create").within(() => {
      cy.contains("button", /^(Back|Atrás)$/).should("not.exist");
    });

    // …but a forward affordance to the pick list, which works.
    cy.get(".cust-create")
      .contains("button", /choose an existing customer/i)
      .should("be.visible")
      .click();
    cy.get(".cust-dd__trigger").should("be.visible");
  });
});
