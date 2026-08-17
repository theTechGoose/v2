/// <reference types="cypress" />

/**
 * PDF p8 — "Job Name … is going to be consistent throughout the platform.
 * It needs to take the job details and summarize that into a job name using
 * three words or less."
 *
 * The SAME ≤3-word name must appear on: the quotes list/card, the contract
 * (public), and the invoice.
 */
describe("job name — ≤3 words, consistent platform-wide", () => {
  const PHONE = "+15125550928";
  const JOB_NAME = "Backyard Junk Removal";
  let ids: { quoteId: string; contractId: string; invoiceId: string };

  before(() => {
    cy.clearCookies();
    cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "en" }); // fresh users default to es; EN copy asserted
    cy.seedQuoteToCash({
      quote: {
        jobName: JOB_NAME,
        summary: "Removing junk from a backyard",
        description: "Removing junk from a backyard and making sure no trash remains",
      },
    }).then((seeded) => {
      ids = seeded;
    });
  });

  beforeEach(() => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "en"); // re-pin EN after the wipe (Spanish-first app)
    cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "en" }); // fresh users default to es; EN copy asserted
  });

  it("the quotes list shows the job name (≤3 words), not the long description", () => {
    cy.visit("/quotes");
    cy.contains(JOB_NAME, { timeout: 10_000 }).should("be.visible");
  });

  it("the public contract heads with the same job name", () => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "en");
    cy.visit(`/c/${ids.contractId}`);
    cy.contains(JOB_NAME, { timeout: 10_000 }).should("be.visible");
  });

  it("the invoice carries the same job name", () => {
    cy.visit(`/invoices?open=${ids.invoiceId}`);
    cy.contains(JOB_NAME, { timeout: 10_000 }).should("be.visible");
  });

  it("a quote created WITHOUT an explicit name derives one of three words or less", () => {
    cy.apiCreateCustomer({ name: "Iron Man", phone: "+15125550929" }).then((customerId) =>
      cy.apiCreateQuote({
        customerId,
        summary: "Full kitchen refresh with cabinet resurfacing and new backsplash",
        lineItems: [{ description: "Kitchen refresh", quantity: 1, unit: "job", price: 250000 }],
        estimatedTotal: 250000,
      })
    ).then((id) => {
      cy.request(`/api/quotes/${id}`).then(({ body }) => {
        expect(body.jobName, "derived jobName").to.be.a("string").and.not.be.empty;
        expect(body.jobName.trim().split(/\s+/).length).to.be.at.most(3);
      });
    });
  });
});
