/// <reference types="cypress" />

/**
 * Custom Cypress commands tailored to the v2 app.
 *
 * Auth is cookie-based; tests that need a logged-in contractor should
 * call cy.loginAs(phoneNumber) before any UI assertions. Dev/local uses
 * a universal master OTP code (000000) — the verify-otp coordinator
 * bypasses the OTP record lookup when this code is presented and the
 * process isn't running on Deno Deploy. Disabled in prod.
 *
 * Commands are grouped:
 *   Auth:       cy.loginAs
 *   Customers:  cy.apiCreateCustomer
 *   Quotes:     cy.apiCreateQuote, cy.apiAcceptQuote, cy.apiDeclineQuote,
 *               cy.apiInquiry, cy.apiSendQuoteEmail
 *   Invoices:   cy.apiCreateInvoice, cy.apiClaimPayment, cy.apiConfirmPayment,
 *               cy.apiSendInvoiceEmail
 *   Profile:    cy.apiUpdateProfile, cy.apiUpdateUser
 *   Composite:  cy.seedQuoteToCash
 */

// ---------------------------------------------------------------------------
// Type declarations
// ---------------------------------------------------------------------------

interface SeedQuoteToCashResult {
  customerId: string;
  quoteId: string;
  invoiceId: string;
}

declare global {
  // deno-lint-ignore no-namespace
  namespace Cypress {
    interface Chainable {
      /** Pause the runner between scripted steps when CYPRESS_STEP=1 is set
       *  (or env STEP=true via cypress.env). No-op otherwise, so the same
       *  spec runs full-speed in CI. Optional label is logged to the runner. */
      step(label?: string): Chainable<void>;

      /** Seed an authenticated session as a specific user via the
       *  dev master-OTP bypass. Pass an E.164-ish phone (e.g. "+15125551234").
       *  The user is created on first login. Dev/local only. */
      loginAs(phoneNumber: string): Chainable<void>;

      /** Land on the customer step's CREATE form regardless of entry view:
       *  the step opens on the pick LIST when the account has saved
       *  customers (single-back / pick-existing rules, 2026-08-19) and
       *  directly on the form when it has none. Clicks "+ New customer"
       *  when the list shows, then waits for the form. */
      openCustomerCreateForm(): Chainable<void>;

      /** Start the REAL onboarding flow for `phoneNumber`. Wipes any
       *  prior KV record for that number, sends a real OTP, reads the
       *  pending code from KV, and verifies — landing the browser in
       *  the `isNewUser: true` state without the dev master shortcut.
       *  Use this for any test that needs to exercise the onboarding
       *  conversation itself. Dev/local only. */
      startFreshOnboarding(
        phoneNumber: string,
      ): Chainable<{ redirectTo: string; userId: string }>;

      // -- Customers ----------------------------------------------------------
      /** Create a customer via the backend API. Returns its id. */
      apiCreateCustomer(body: Record<string, unknown>): Chainable<string>;

      // -- Quotes -------------------------------------------------------------
      /** Create a quote via the backend API. Returns its id. */
      apiCreateQuote(body: Record<string, unknown>): Chainable<string>;

      /** Customer accepts a public quote (no auth required). Accepting IS
       *  the signature ceremony — on success the backend also creates the
       *  milestone invoices from the quote's payment terms. */
      apiAcceptQuote(
        quoteId: string,
        body?: { signature?: string; name?: string; tin?: string },
      ): Chainable<Cypress.Response<unknown>>;

      /** Customer declines a public quote (no auth required). */
      apiDeclineQuote(
        quoteId: string,
        body?: { reason?: string; note?: string; name?: string },
      ): Chainable<Cypress.Response<unknown>>;

      /** Customer asks a question on a public quote. */
      apiInquiry(
        quoteId: string,
        body: { question: string; contactBack?: string; name?: string },
      ): Chainable<Cypress.Response<unknown>>;

      /** Send quote email to the customer (contractor auth required). */
      apiSendQuoteEmail(quoteId: string): Chainable<Cypress.Response<unknown>>;

      // -- Invoices -----------------------------------------------------------
      /** Create an invoice via the backend API. Returns its id. */
      apiCreateInvoice(body: Record<string, unknown>): Chainable<string>;

      /** Public claim endpoint (customer side, no auth required). */
      apiClaimPayment(
        invoiceId: string,
        body: { method: string; reference?: string; claimedBy?: string },
      ): Chainable<Cypress.Response<unknown>>;

      /** Contractor confirm. Requires loginAs first. */
      apiConfirmPayment(
        invoiceId: string,
      ): Chainable<Cypress.Response<unknown>>;

      /** Send invoice email to the customer (contractor auth required). */
      apiSendInvoiceEmail(
        invoiceId: string,
      ): Chainable<Cypress.Response<unknown>>;

      // -- Profile ------------------------------------------------------------
      /** Update the contractor's payment methods / business identity. */
      apiUpdateProfile(
        body: Record<string, unknown>,
      ): Chainable<Cypress.Response<unknown>>;

      /** Update the authenticated user (name, language, etc.). */
      apiUpdateUser(
        body: Record<string, unknown>,
      ): Chainable<Cypress.Response<unknown>>;

      // -- Composite ----------------------------------------------------------
      /**
       * Seed a full customer → quote → invoice chain (the quote IS the
       * agreement — there is no separate contract entity).
       * Requires loginAs first. Returns all created IDs.
       */
      seedQuoteToCash(
        overrides?: Partial<{
          customer: Record<string, unknown>;
          quote: Record<string, unknown>;
          invoice: Record<string, unknown>;
        }>,
      ): Chainable<SeedQuoteToCashResult>;
    }
  }
}

// ---------------------------------------------------------------------------
// Stepping
// ---------------------------------------------------------------------------

Cypress.Commands.add("step", (label?: string) => {
  if (!Cypress.env("STEP")) return;
  if (label) cy.log(`▶︎ ${label}`);
  cy.pause();
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

Cypress.Commands.add("loginAs", (phoneNumber: string) => {
  cy.request({
    method: "POST",
    url: "/api/auth/verify",
    body: { phoneNumber, code: "000000" },
  });
  // Ensure the user has the onboarding-gate fields set so specs that
  // call loginAs and immediately visit /dashboard don't get redirected
  // to /assistant?onboard=1 just because the master OTP no longer
  // auto-seeds them. Idempotent: skips when the fields are already set.
  cy.request("/api/me").then((meRes) => {
    const me = meRes.body as { name?: string };
    if (!me?.name || me.name.trim().length === 0) {
      cy.request({
        method: "PUT",
        url: "/api/me",
        body: { name: "Dev User" },
        failOnStatusCode: false,
      });
    }
  });
  cy.request("/api/profile/identity").then((idRes) => {
    const biz = (idRes.body as { businessName?: string } | null)?.businessName;
    if (!biz || biz.trim().length === 0) {
      cy.request({
        method: "PUT",
        url: "/api/profile/identity",
        body: { businessName: "Dev Business" },
        failOnStatusCode: false,
      });
    }
  });
});

Cypress.Commands.add("startFreshOnboarding", (phoneNumber: string) => {
  // The wipe + OTP read helpers live in backend/scripts. cy.exec runs
  // from the cypress/ directory, so we cd one level up first. We swallow
  // non-zero exits for the wipe (a never-seen phone produces "wiped 0
  // keys" successfully; the script only fails on bad args).
  cy.exec(
    `cd ../backend && deno run -A --unstable-kv scripts/dev-wipe-user.ts ${phoneNumber}`,
    { failOnNonZeroExit: true, timeout: 30_000 },
  );
  // Seed the new user as English so the English-asserting specs are
  // deterministic (the app is Spanish-first, so a language-less signup would
  // otherwise default to "es"). Specs that want Spanish PUT language:"es".
  cy.request("POST", "/api/auth/send-otp", { phoneNumber, language: "en" })
    .its("status").should("eq", 200);
  return cy
    .exec(
      `cd ../backend && deno run -A --unstable-kv scripts/dev-get-otp.ts ${phoneNumber}`,
      { failOnNonZeroExit: true, timeout: 30_000 },
    )
    .then((r) => {
      const code = r.stdout.trim();
      expect(code, "real OTP code from KV").to.match(/^\d{6}$/);
      return cy
        .request("POST", "/api/auth/verify", { phoneNumber, code })
        .then((res) => {
          expect(res.body.ok, `verify ok for ${phoneNumber}`).to.eq(true);
          return cy.wrap({
            redirectTo: res.body.redirectTo,
            userId: res.body.userId,
          });
        });
    });
});

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

Cypress.Commands.add("apiCreateCustomer", (body: Record<string, unknown>) => {
  return cy
    .request("POST", "/api/customers", body)
    .its("body")
    .then((b: { id: string }) => b.id);
});

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

Cypress.Commands.add("apiCreateQuote", (body: Record<string, unknown>) => {
  return cy
    .request("POST", "/api/quotes", body)
    .its("body")
    .then((b: { id: string }) => b.id);
});

Cypress.Commands.add("apiAcceptQuote", (quoteId: string, body = {}) => {
  return cy.request({
    method: "POST",
    url: `/api/quotes/${quoteId}/accept`,
    body,
    failOnStatusCode: false,
  });
});

Cypress.Commands.add("apiDeclineQuote", (quoteId: string, body = {}) => {
  return cy.request({
    method: "POST",
    url: `/api/quotes/${quoteId}/decline`,
    body,
    failOnStatusCode: false,
  });
});

Cypress.Commands.add("apiInquiry", (quoteId: string, body) => {
  return cy.request({
    method: "POST",
    url: `/api/quotes/${quoteId}/inquiry`,
    body,
    failOnStatusCode: false,
  });
});

Cypress.Commands.add("apiSendQuoteEmail", (quoteId: string) => {
  return cy.request({
    method: "POST",
    url: `/api/quotes/${quoteId}/email`,
    failOnStatusCode: false,
  });
});

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

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

Cypress.Commands.add("apiSendInvoiceEmail", (invoiceId: string) => {
  return cy.request({
    method: "POST",
    url: `/api/invoices/${invoiceId}/email`,
    failOnStatusCode: false,
  });
});

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

Cypress.Commands.add("apiUpdateProfile", (body: Record<string, unknown>) => {
  return cy.request({
    method: "PUT",
    url: "/api/profile/identity",
    body,
    failOnStatusCode: false,
  });
});

Cypress.Commands.add("apiUpdateUser", (body: Record<string, unknown>) => {
  return cy.request({
    method: "PUT",
    url: "/api/me",
    body,
    failOnStatusCode: false,
  });
});

// ---------------------------------------------------------------------------
// Composite: seed a full quote-to-cash chain
// ---------------------------------------------------------------------------

Cypress.Commands.add("seedQuoteToCash", (overrides = {}) => {
  const customerBody = overrides.customer ??
    { name: "Asha Patel", email: "asha@example.com", phone: "+15125559876" };
  const lineItems = [{
    description: "Fence repair",
    quantity: 1,
    unit: "ea",
    price: 35_000,
  }];

  return cy.apiCreateCustomer(customerBody).then((customerId: string) => {
    const quoteBody = {
      summary: "Fence repair",
      jobName: "Fence Repair",
      lineItems,
      customerId,
      estimatedTotal: 35_000,
      ...overrides.quote,
    };
    return cy.apiCreateQuote(quoteBody).then((quoteId: string) => {
      const invoiceBody = {
        // quoteId triggers the derive-from-quote path so the invoice
        // carries the quote's jobName/description (roadmap p.6).
        quoteId,
        customerId,
        amount: 35_000,
        dueDate: "2099-01-01",
        status: "sent",
        installmentIndex: 1,
        installmentTotal: 1,
        ...overrides.invoice,
      };
      return cy.apiCreateInvoice(invoiceBody).then((invoiceId: string) => {
        return cy.wrap<SeedQuoteToCashResult>({
          customerId,
          quoteId,
          invoiceId,
        });
      });
    });
  });
});

Cypress.Commands.add("openCustomerCreateForm", () => {
  // Either the create form (empty account) or the pick list (saved
  // customers exist) renders — wait for whichever arrives, then make sure
  // the create form is the one on screen.
  cy.get(".cust-create, .wiz-opt--custom", { timeout: 20_000 }).should("exist");
  cy.get("body").then(($b) => {
    if ($b.find(".cust-create").length === 0) {
      cy.get(".wiz-opt--custom").filter(":visible").first().click();
    }
  });
  cy.get(".cust-create", { timeout: 10_000 }).should("be.visible");
});

export {};
