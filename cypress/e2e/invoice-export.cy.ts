/// <reference types="cypress" />

/**
 * Tax-time CSV export — sanity coverage that the /api/invoices/export.csv
 * endpoint returns the expected MIME type and a header row.
 *
 * We don't validate the full row set (that's covered by backend unit
 * tests); the goal here is that the contractor-facing "Export CSV"
 * button on /invoices actually triggers a download with the right
 * Content-Type so browsers don't render it inline as text.
 */
describe("invoice — tax-time export", () => {
  const CONTRACTOR_EMAIL = "dev@paperworkmonster.com";

  it("returns a CSV with the expected headers and Content-Disposition", () => {
    cy.loginAs(CONTRACTOR_EMAIL);
    cy.request({
      method: "GET",
      url: `/api/invoices/export.csv?year=${new Date().getFullYear()}`,
    }).then((res) => {
      expect(res.headers["content-type"]).to.contain("text/csv");
      expect(res.headers["content-disposition"]).to.contain(".csv");
      const firstLine = (res.body as string).split("\r\n")[0];
      expect(firstLine).to.equal("Date,Customer,Job,Amount,Method,Reference");
    });
  });

  it("the /invoices hero exposes an Export button that links to the CSV", () => {
    cy.loginAs(CONTRACTOR_EMAIL);
    cy.visit("/invoices");
    cy.get('[data-cy="invoice-export"]')
      .should("have.attr", "href")
      .and("contain", "/api/invoices/export.csv");
  });
});
