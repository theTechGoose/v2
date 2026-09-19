/// <reference types="cypress" />

/**
 * REQ-009 — NW-24 (p23): "Change 'Job Completed' to 'Job completed'
 * (lowercase c)." Term values are PERSISTED in English and re-localized by
 * exact string match (front-end/lib/term-i18n.ts). New quotes save
 * "Job completed"; old quotes still carry "Job Completed" — the Spanish
 * public quote must print "Trabajo terminado" for BOTH, and the English one
 * the sentence-case spelling.
 */
describe("REQ-009 NW-24 public quote — 'Job completed' casing, old and new", () => {
  const PHONE = "+15125550929";
  let customerId: string;

  // Test isolation clears cookies before every test: log in + seed the
  // customer per test, not once.
  beforeEach(() => {
    cy.clearCookies();
    cy.loginAs(PHONE);
    cy.apiCreateCustomer({
      name: "Casing Customer",
      email: "casing.customer@blackhole.postmarkapp.com",
      phoneNumber: "+15125550930",
    }).then((id) => {
      customerId = id;
    });
  });

  function seedWithDuration(value: string) {
    return cy.apiCreateQuote({
      customerId,
      summary: "Fence repair",
      jobName: "Fence Repair",
      lineItems: [{ description: "Fence repair", quantity: 1, unit: "job", price: 50000 }],
      estimatedTotal: 50000,
      terms: [{ stepId: "wraps", label: "Duration", value }],
    });
  }

  it("REQ-009 NW-24 a NEW quote saved as 'Job completed' prints 'Trabajo terminado' in Spanish", () => {
    seedWithDuration("Job completed").then((id) => {
      cy.clearCookies();
      cy.setCookie("pm_lang", "es");
      cy.visit(`/q/${id}`);
      cy.contains("Trabajo terminado", { timeout: 20_000 }).should("be.visible");
      cy.contains(/Job completed/i).should("not.exist");
    });
  });

  it("REQ-009 NW-24 an OLD quote saved as 'Job Completed' still prints 'Trabajo terminado' in Spanish", () => {
    seedWithDuration("Job Completed").then((id) => {
      cy.clearCookies();
      cy.setCookie("pm_lang", "es");
      cy.visit(`/q/${id}`);
      cy.contains("Trabajo terminado", { timeout: 20_000 }).should("be.visible");
      cy.contains(/Job completed/i).should("not.exist");
    });
  });

  it("REQ-009 NW-24 the English quote shows the sentence-case 'Job completed'", () => {
    seedWithDuration("Job completed").then((id) => {
      cy.clearCookies();
      cy.setCookie("pm_lang", "en");
      cy.visit(`/q/${id}`);
      cy.contains("Job completed", { timeout: 20_000 }).should("be.visible");
      cy.contains("Job Completed").should("not.exist");
    });
  });
});
