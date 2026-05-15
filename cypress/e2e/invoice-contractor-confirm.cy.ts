/// <reference types="cypress" />

/**
 * Contractor confirms a customer's claimed payment.
 *
 * Flow under test:
 *   1. Seed: invoice in `claimed` status with a payment intent.
 *   2. Contractor opens /invoices → sees "Awaiting confirmation" track
 *      with the invoice card.
 *   3. Taps "Confirm received" → invoice flips to `paid`, card moves to
 *      "Paid this month" on reload.
 */
describe("contractor — confirm received", () => {
  const CONTRACTOR_EMAIL = "dev@paperworkmonster.com";

  it("confirms a claimed payment and moves the card to paid", () => {
    cy.loginAs(CONTRACTOR_EMAIL);
    cy.request("POST", "/api/customers", { name: "Confirm Test Customer", email: "ct@example.com" }).then((c) => {
      const customerId = (c.body as { id: string }).id;
      cy.request("POST", "/api/quotes", {
        summary: "Junk Removal", jobName: "Junk Removal",
        lineItems: [{ description: "Removal", quantity: 1, unit: "ea", price: 18_000 }],
        customerId, estimatedTotal: 18_000,
      }).then((q) => {
        cy.request("POST", "/api/contracts", { quoteId: (q.body as { id: string }).id, customerId, totalAmount: 18_000 }).then((ct) => {
          cy.request("POST", "/api/invoices", {
            contractId: (ct.body as { id: string }).id,
            customerId,
            amount: 18_000,
            dueDate: "2099-01-01",
            status: "sent",
          }).then((iRes) => {
            const invoiceId = (iRes.body as { id: string }).id;
            // Customer claims (no auth).
            cy.clearCookies();
            cy.apiClaimPayment(invoiceId, { method: "check", reference: "#9999" });
            // Contractor confirms via UI.
            cy.loginAs(CONTRACTOR_EMAIL);
            cy.visit("/invoices");
            cy.get('[data-cy="awaiting-confirmation-track"]').should("exist");
            cy.get('[data-cy="invoice-cta-claimed"]').first().click();
            // After reload, the invoice should land in "Paid this month."
            cy.contains(/Paid this month/i).click(); // expand the (collapsed-by-default) track
            cy.contains("$180").should("be.visible");
          });
        });
      });
    });
  });

  it("'Mute' on an overdue invoice persists and reloads as 'Muted'", () => {
    cy.loginAs(CONTRACTOR_EMAIL);
    cy.request("POST", "/api/customers", { name: "Mute Test" }).then((c) => {
      cy.request("POST", "/api/quotes", {
        summary: "Job", lineItems: [], customerId: (c.body as { id: string }).id,
      }).then((q) => {
        cy.request("POST", "/api/contracts", { quoteId: (q.body as { id: string }).id }).then((ct) => {
          // Past dueDate → enriches as overdue.
          cy.request("POST", "/api/invoices", {
            contractId: (ct.body as { id: string }).id,
            customerId: (c.body as { id: string }).id,
            amount: 5_000,
            dueDate: "2020-01-01",
            status: "sent",
            issuedDate: "2019-12-25",
          }).then(() => {
            cy.visit("/invoices");
            // Expand the overdue card to reach the mute toggle on the back face.
            cy.contains(/Overdue/i).should("be.visible");
            cy.get('[data-cy="invoice-mute-toggle"]').first().click();
            // Page reloads; mute toggle should now read "Muted".
            cy.get('[data-cy="invoice-mute-toggle"]').first().should("contain", "Muted");
          });
        });
      });
    });
  });
});
