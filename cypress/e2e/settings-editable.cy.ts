/// <reference types="cypress" />

/**
 * PDF p8 — "Settings — Make the rest of the stuff editable":
 *   - Mailing Address
 *   - Allow for Insurance to be uploaded
 *   - Tax W-9
 *
 * Contract selectors: [data-cy=settings-mailing-address],
 * [data-cy=settings-insurance-upload], [data-cy=settings-w9-upload].
 */
describe("settings — mailing address, insurance, W-9 are editable", () => {
  const PHONE = "+15125550937";

  beforeEach(() => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "en"); // re-pin EN after the wipe (Spanish-first app)
    cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "en" }); // fresh users default to es; EN copy asserted
    cy.visit("/settings");
  });

  it("mailing address is editable and persists across reload", () => {
    cy.get("[data-cy=settings-mailing-address]", { timeout: 10_000 })
      .should("be.visible")
      .within(() => {
        cy.get("input").first().clear().type("123 Main St");
        cy.get("input").eq(1).clear().type("Austin");
      });
    cy.contains("button", /save|guardar/i).click();

    cy.reload();
    cy.get("[data-cy=settings-mailing-address] input")
      .first()
      .should("have.value", "123 Main St");
  });

  it("insurance offers a file upload control", () => {
    cy.get("[data-cy=settings-insurance-upload]", { timeout: 10_000 })
      .should("be.visible")
      .find("input[type=file]")
      .should("exist");
  });

  it("an uploaded insurance document is listed afterwards", () => {
    cy.get("[data-cy=settings-insurance-upload] input[type=file]").selectFile(
      {
        contents: Cypress.Buffer.from("%PDF-1.4 fake-policy"),
        fileName: "policy.pdf",
        mimeType: "application/pdf",
      },
      { force: true },
    );
    cy.contains(/policy\.pdf/i, { timeout: 10_000 }).should("be.visible");
  });

  it("W-9 offers a file upload control and lists the uploaded form", () => {
    cy.get("[data-cy=settings-w9-upload]", { timeout: 10_000 })
      .should("be.visible")
      .find("input[type=file]")
      .should("exist");
    cy.get("[data-cy=settings-w9-upload] input[type=file]").selectFile(
      {
        contents: Cypress.Buffer.from("%PDF-1.4 fake-w9"),
        fileName: "w9.pdf",
        mimeType: "application/pdf",
      },
      { force: true },
    );
    cy.contains(/w9\.pdf/i, { timeout: 10_000 }).should("be.visible");
  });
});
