/// <reference types="cypress" />

/**
 * Global support file. Imported automatically by every spec via the
 * `supportFile` option in cypress.config.ts.
 *
 * Add shared commands here (e.g. cy.login, cy.seedInvoice) so individual
 * specs stay focused on user behavior.
 */

import "./commands";

// Fail loud on uncaught errors that originate in the app under test. The
// default is silent, which hides real bugs (e.g. a hydration mismatch on
// the public invoice page would otherwise pass).
Cypress.on("uncaught:exception", (err) => {
  // Carve out one known noisy warning from Preact dev that's not a real
  // failure. Anything else surfaces as a test failure.
  if (/Preact: registerComponent/.test(err.message)) return false;
  return true;
});
