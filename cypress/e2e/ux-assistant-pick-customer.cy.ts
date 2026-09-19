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

// ===========================================================================
// REQ-029 — NW-22 / NW-35 (p15, p30): "I created a new customer ('Incredible
// Hulk') and it did not save." / "You can create customers from the Customers
// page but not from My Assistant." The dropdown's text box is a search filter
// whose no-match state was a dead end, and Next was silently disabled without
// a contact. Now: no match → "Create "<name>"" opens the form prefilled; the
// missing-contact reason is visible, not just a disabled button.
// ===========================================================================
describe("REQ-029 NW-22/35 create a customer straight from the assistant dropdown", () => {
  const PHONE = "+15125556254";
  const HULK = "Incredible Hulk";

  beforeEach(() => {
    cy.viewport(1280, 800);
    cy.clearCookies();
    cy.setCookie("pm_lang", "en");
    cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "en", name: "Picker Contractor" });
    cy.request("POST", "/api/me/onboarded", { skipped: true });
    // One saved customer so the step opens on the pick list.
    cy.request("POST", "/api/customers", {
      name: "Existing Eddie",
      phoneNumber: "+15125556253",
    });
    cy.visit("/assistant?dev");
    cy.get(".chat__empty-debug-btn", { timeout: 10_000 }).should("be.visible").click();
    cy.location("pathname", { timeout: 20_000 }).should("match", /^\/assistant\/[A-Za-z0-9-]+$/);
    cy.get(".cust-dd__trigger", { timeout: 20_000 }).should("be.visible").click();
    cy.get(".cust-pick__search").should("be.visible");
  });

  it("REQ-029 a no-match search offers Create \"<name>\" → the form opens prefilled → Next saves the customer", () => {
    cy.get(".cust-pick__search").type(HULK);
    cy.get("[data-cy=cust-create-from-search]")
      .should("be.visible")
      .and("contain.text", `Create "${HULK}"`)
      .click();
    cy.get(".cust-create").should("be.visible");
    cy.get(".cust-create input").first().should("have.value", HULK);
    cy.get(".cust-create input[placeholder='Phone Number']").type("5125556299");
    cy.get(".cust-create").contains("button", /^Next$/).should("not.be.disabled").click();
    // The step completes with the new customer bound and the wizard moves on.
    cy.contains(HULK, { timeout: 15_000 }).should("be.visible");
    cy.contains(/when does the job start/i, { timeout: 15_000 }).should("be.visible");
    cy.request("/api/customers").its("body").should((rows: Array<{ name: string }>) => {
      expect(rows.map((r) => r.name), "the assistant-created customer is on the Customers list").to.include(HULK);
    });
  });

  it("REQ-029 name only, no contact → the reason is visible, not just a disabled Next", () => {
    cy.contains("button", "+ New customer").click();
    cy.get(".cust-create").should("be.visible");
    cy.get(".cust-create input").first().type("Green Machine");
    cy.get("[data-cy=cust-contact-hint]")
      .should("be.visible")
      .and("contain.text", "Add a phone number or email");
  });
});
