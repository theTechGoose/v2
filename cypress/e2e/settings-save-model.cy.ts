/// <reference types="cypress" />

/**
 * RED (TDD) desktop specs (1440×900) for P-42.
 *
 * P-42 [SETTINGS] "Three save models on one page." The header promises
 *   "changes save as you go" (settings.heroSub / ES "se guardan al instante"),
 *   yet the mailing address and payment methods need an explicit Guardar, and
 *   "Contract defaults" is a dead read-only card ("Nothing set yet." / ES "Aún
 *   no hay nada.") with no action. Desired: one coherent instant-save model —
 *   edits persist without an explicit Save — and the contract-defaults card
 *   exposes a working action (backend GET/PUT /profile/contract-defaults).
 *
 * PROBE NOTES (for the green agent):
 *   - AddressEditCard ([data-cy=settings-mailing-address]) + PaymentsEditCard
 *     save only via their explicit Save buttons ("Save address" /
 *     "Save payment methods"); nothing persists on blur/navigation today.
 *   - The "Contract defaults" panel is a read-only <Card> (`div.panel`) with no
 *     button/link. Backend already serves GET/PUT /profile/contract-defaults
 *     ({ paymentTermsDays, depositPct, warrantyDays }).
 */
describe("P-42 /settings honors one instant-save model everywhere", () => {
  const PHONE = "+15125552840";

  beforeEach(() => {
    cy.viewport(1440, 900);
    cy.clearCookies();
    cy.setCookie("pm_lang", "en"); // re-pin EN after the wipe (Spanish-first app)
    cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "en" });
    cy.request({
      method: "POST",
      url: "/api/me/onboarded",
      body: { skipped: true },
      failOnStatusCode: false,
    });
    cy.visit("/settings");
  });

  it("P-42 the mailing address persists without pressing Save", () => {
    cy.get("[data-cy=settings-mailing-address]", { timeout: 10_000 })
      .scrollIntoView()
      .within(() => {
        cy.get("input").first().clear().type("123 Main St");
      });

    // Do NOT click Save — the header promises edits save as you go.
    cy.visit("/dashboard");
    cy.visit("/settings");

    cy.get("[data-cy=settings-mailing-address] input", { timeout: 10_000 })
      .first()
      .should("have.value", "123 Main St");
  });

  it("P-42 a payment method persists without pressing Save", () => {
    // The payments panel has no data-cy — locate it by its Save button.
    cy.contains("button", /save payment methods|guardar formas de pago/i, {
      timeout: 10_000,
    }).closest(".panel").as("payments");

    // Enable "Cash" — a handle-less method, so there's nothing else to fill.
    cy.get("@payments")
      .contains("label", /^\s*(cash|efectivo)\s*$/i)
      .find("input[type=checkbox]")
      .check();

    // Do NOT click Save.
    cy.visit("/dashboard");
    cy.visit("/settings");

    cy.contains("button", /save payment methods|guardar formas de pago/i, {
      timeout: 10_000,
    }).closest(".panel").as("payments2");

    cy.get("@payments2")
      .contains("label", /^\s*(cash|efectivo)\s*$/i)
      .find("input[type=checkbox]")
      .should("be.checked");
  });

  it("P-42 the 'Contract defaults' card is not dead — it offers a way to edit them", () => {
    cy.contains(/^contract defaults$|^valores del contrato$/i, { timeout: 10_000 })
      .closest(".panel")
      .as("cd");

    // A live card exposes an interactive affordance (button/link/field) that
    // leads to editing the contract defaults — not just static "Nothing set yet."
    cy.get("@cd").find("button, a, input, select").should("exist");
  });
});
