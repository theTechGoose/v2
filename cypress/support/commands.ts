/// <reference types="cypress" />

/**
 * Custom Cypress commands tailored to the v2 app.
 *
 * - cy.apiCreateInvoice / cy.apiClaimPayment / cy.apiConfirmPayment:
 *   thin wrappers around the backend's JSON endpoints so specs can seed
 *   state without driving the entire contractor UI for every test.
 *
 * Auth is cookie-based; tests that need a logged-in contractor should
 * call cy.loginAs(email) before any UI assertions. In the test fixture,
 * a magic dev-only auth header is accepted (X-Test-User), but tests
 * should prefer the proper /api/auth/dev-login flow.
 */

declare global {
  // deno-lint-ignore no-namespace
  namespace Cypress {
    interface Chainable {
      /** Seed an authenticated session as a specific user. Dev-only. */
      loginAs(email: string): Chainable<void>;

      /** Create an invoice via the backend API. Returns its id. */
      apiCreateInvoice(body: Record<string, unknown>): Chainable<string>;

      /** Public claim endpoint (customer side, no auth required). */
      apiClaimPayment(
        invoiceId: string,
        body: { method: string; reference?: string; claimedBy?: string },
      ): Chainable<Cypress.Response<unknown>>;

      /** Contractor confirm. Requires loginAs first. */
      apiConfirmPayment(invoiceId: string): Chainable<Cypress.Response<unknown>>;
    }
  }
}

Cypress.Commands.add("loginAs", (email: string) => {
  // The dev-login endpoint accepts an email and mints a session cookie.
  // In prod this endpoint is gated by APP_ENV !== 'prod'.
  cy.request({
    method: "POST",
    url: "/api/auth/dev-login",
    body: { email },
    failOnStatusCode: false,
  });
});

Cypress.Commands.add("apiCreateInvoice", (body: Record<string, unknown>) => {
  return cy
    .request("POST", "/api/invoices", body)
    .its("body")
    .then((b: { id: string }) => b.id);
});

Cypress.Commands.add("apiClaimPayment", (invoiceId, body) => {
  return cy.request({
    method: "POST",
    url: `/api/invoices/${invoiceId}/claim-payment`,
    body,
    failOnStatusCode: false,
  });
});

Cypress.Commands.add("apiConfirmPayment", (invoiceId) => {
  return cy.request({
    method: "POST",
    url: `/api/invoices/${invoiceId}/confirm-payment`,
    failOnStatusCode: false,
  });
});

export {};
