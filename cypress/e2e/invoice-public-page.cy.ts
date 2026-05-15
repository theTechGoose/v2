/// <reference types="cypress" />

/**
 * Public invoice page (/i/:id) — customer-side claim flow.
 *
 * These specs exercise the user-visible behavior of the public invoice
 * page that recipients open from a text or email link. They run against
 * the local dev server (deno task serve) and require an invoice that's
 * already been created (we hit the backend API directly to seed one).
 *
 * Auth: the public page itself is unauthenticated. We do call /api on
 * the contractor side to seed data — that requires a session, which
 * cy.loginAs handles.
 */
describe("public invoice page", () => {
  // Adjust this contractor login if your local dev seeds a different user.
  const CONTRACTOR_EMAIL = "dev@paperworkmonster.com";

  beforeEach(() => {
    // Each spec starts from a clean cookie jar so the customer view
    // doesn't leak the contractor's session.
    cy.clearCookies();
  });

  it("renders the not-found state for an unknown invoice id", () => {
    // Two-segment path so the id is unambiguously not present.
    cy.visit("/i/00000000-0000-0000-0000-000000000000", { failOnStatusCode: false });
    cy.contains(/can't open this|not available|expired/i).should("be.visible");
  });

  it("shows the claim form when methods are configured + records a claim", () => {
    cy.loginAs(CONTRACTOR_EMAIL);

    // Configure a Venmo handle on the contractor's business identity so
    // the public page has at least one method to surface.
    cy.request("PUT", "/api/profile/identity", {
      acceptedPaymentMethods: {
        venmo: { enabled: true, handle: "@hans-hansen" },
        check: { enabled: true, mailTo: "1234 Main St" },
      },
    });

    // Seed a customer + contract + invoice.
    cy.request("POST", "/api/customers", { name: "Hans Pedersen" }).then((cRes) => {
      const customerId = (cRes.body as { id: string }).id;
      cy.request("POST", "/api/quotes", {
        summary: "Backyard Junk Removal",
        jobName: "Backyard Junk",
        lineItems: [{ description: "Removal", quantity: 1, unit: "ea", price: 18_000 }],
        customerId,
        estimatedTotal: 18_000,
      }).then((qRes) => {
        const quoteId = (qRes.body as { id: string }).id;
        cy.request("POST", "/api/contracts", { quoteId, customerId, totalAmount: 18_000 }).then((conRes) => {
          const contractId = (conRes.body as { id: string }).id;
          cy.request("POST", "/api/invoices", {
            contractId,
            customerId,
            amount: 18_000,
            dueDate: "2099-01-01",
            status: "sent",
            installmentIndex: 1,
            installmentTotal: 2,
          }).then((iRes) => {
            const invoiceId = (iRes.body as { id: string }).id;

            // Visit as the customer (no session).
            cy.clearCookies();
            cy.visit(`/i/${invoiceId}`);

            // Hero copy reflects the job name + milestone.
            cy.contains("Backyard Junk").should("be.visible");
            cy.contains(/Invoice 1 of 2/).should("be.visible");

            // Methods render.
            cy.get('[data-cy="claim-form"]').within(() => {
              cy.get('[data-cy="claim-method-venmo"]').should("be.visible");
              cy.get('[data-cy="claim-method-check"]').should("be.visible");
            });

            // Pick venmo → details panel appears → submit.
            cy.get('[data-cy="claim-method-venmo"]').click();
            cy.get('[data-cy="claim-detail"]').should("contain", "@hans-hansen");
            cy.get('[data-cy="claim-reference"]').type("Sent 5/12");
            cy.get('[data-cy="claim-name"]').clear().type("Hans P.");
            cy.get('[data-cy="claim-submit"]').click();

            // Thanks view should land.
            cy.get('[data-cy="claim-thanks"]').should("be.visible");

            // Reload as customer — invoice now shows "Awaiting confirmation."
            cy.reload();
            cy.contains(/Awaiting confirmation/i).should("be.visible");
            cy.contains("Sent 5/12").should("be.visible");
          });
        });
      });
    });
  });

  it("falls back to a 'reach out' message when no methods are configured", () => {
    cy.loginAs(CONTRACTOR_EMAIL);

    // Wipe accepted methods to test the empty state.
    cy.request("PUT", "/api/profile/identity", { acceptedPaymentMethods: {} });

    cy.request("POST", "/api/customers", { name: "Empty State Customer" }).then((cRes) => {
      cy.request("POST", "/api/quotes", {
        summary: "Empty",
        lineItems: [{ description: "x", quantity: 1, unit: "ea", price: 100 }],
        customerId: (cRes.body as { id: string }).id,
      }).then((qRes) => {
        cy.request("POST", "/api/contracts", { quoteId: (qRes.body as { id: string }).id }).then((conRes) => {
          cy.request("POST", "/api/invoices", {
            contractId: (conRes.body as { id: string }).id,
            customerId: (cRes.body as { id: string }).id,
            amount: 100,
            dueDate: "2099-01-01",
            status: "sent",
          }).then((iRes) => {
            cy.clearCookies();
            cy.visit(`/i/${(iRes.body as { id: string }).id}`);
            cy.get('[data-cy="claim-no-methods"]').should("be.visible");
          });
        });
      });
    });
  });
});
