/// <reference types="cypress" />

/**
 * PDF p18 (Invoices — "This is not working.") — the UI flow:
 *   - adjust an invoice through a DISCOUNT → the displayed total drops
 *   - adjust through a CHANGE ORDER → a NEW approval link (/co/:id) is produced
 *   - the customer approves at that link → the invoice total reflects it
 *
 * Field vocabulary pinned to the shipped DTOs: { description,
 * deltaAmountCents } for change orders; invoice money is `amount`.
 * Contract selectors: [data-cy=invoice-discount-btn],
 * [data-cy=invoice-change-order-btn], [data-cy=change-order-approval-link].
 */
describe("invoice adjustments — discount and change order with customer approval", () => {
  const PHONE = "+15125550932";
  let invoiceId: string;

  beforeEach(() => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "en"); // re-pin EN after the wipe (Spanish-first app)
    cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "en" }); // fresh users default to es; EN copy asserted
    cy.seedQuoteToCash({ invoice: { amount: 35000 } }).then((seeded) => {
      invoiceId = seeded.invoiceId;
    });
  });

  it("a $50 discount drops the displayed total from $350 to $300", () => {
    cy.visit(`/invoices?open=${invoiceId}`);
    cy.contains(/\$\s?350(\.00)?/, { timeout: 10_000 }).should("be.visible");

    cy.get("[data-cy=invoice-discount-btn]").click();
    cy.focused().type("50"); // $50 off
    cy.contains("button", /apply|save/i).click();

    cy.contains(/discount/i).should("be.visible");
    cy.contains(/\$\s?300(\.00)?/).should("be.visible");
  });

  it("a change order produces a NEW approval link for the customer", () => {
    cy.visit(`/invoices?open=${invoiceId}`);
    cy.get("[data-cy=invoice-change-order-btn]", { timeout: 10_000 }).click();
    cy.get("input, textarea").filter(":visible").first().type("Haul extra debris");
    cy.contains(/amount|price|\$/i).parent().find("input").last().type("150");
    cy.contains("button", /create|send|save/i).click();

    cy.get("[data-cy=change-order-approval-link]", { timeout: 10_000 })
      .should("be.visible")
      .invoke("text")
      .should("match", /\/co\//);
  });

  it("a pending change order leaves the total unchanged; customer approval applies it", () => {
    // Create the change order via API (shipped contract) for determinism.
    cy.request("POST", `/api/invoices/${invoiceId}/change-orders`, {
      description: "Haul extra debris",
      deltaAmountCents: 15000,
    }).then(({ body }) => {
      const coId = body.id as string;

      // Pending: contractor view still shows the original $350 total.
      cy.visit(`/invoices?open=${invoiceId}`);
      cy.contains(/pending/i, { timeout: 10_000 }).should("be.visible");
      cy.contains(/\$\s?350(\.00)?/).should("be.visible");
      cy.contains(/\$\s?500(\.00)?/).should("not.exist");

      // Customer opens the approval page and approves.
      cy.clearCookies();
      cy.setCookie("pm_lang", "en");
      cy.visit(`/co/${coId}`);
      cy.contains(/haul extra debris/i, { timeout: 10_000 }).should("be.visible");
      cy.contains("button", /approve/i).click();
      cy.contains(/approved|thank/i, { timeout: 10_000 }).should("be.visible");

      // Contractor sees the change APPLIED: $350 + $150 = $500.
      cy.setCookie("pm_lang", "en");
      cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "en" }); // fresh users default to es; EN copy asserted
      cy.visit(`/invoices?open=${invoiceId}`);
      cy.contains(/\$\s?500(\.00)?/, { timeout: 10_000 }).should("be.visible");
    });
  });

  it("a declined change order leaves the total untouched", () => {
    cy.request("POST", `/api/invoices/${invoiceId}/change-orders`, {
      description: "Unwanted extra",
      deltaAmountCents: 9900,
    }).then(({ body }) => {
      cy.clearCookies();
      cy.setCookie("pm_lang", "en");
      cy.visit(`/co/${body.id}`);
      cy.contains("button", /decline/i, { timeout: 10_000 }).click();

      cy.setCookie("pm_lang", "en");
      cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "en" }); // fresh users default to es; EN copy asserted
      cy.visit(`/invoices?open=${invoiceId}`);
      cy.contains(/declined/i, { timeout: 10_000 }).should("be.visible");
      // Total still the original $350 — the declined $99 never applied.
      cy.contains(/\$\s?350(\.00)?/).should("be.visible");
      cy.contains(/\$\s?449(\.00)?/).should("not.exist");
    });
  });
});
