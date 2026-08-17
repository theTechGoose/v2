/// <reference types="cypress" />

/**
 * PDF p12 + p14 — the public contract document ("Quote & Agreement - Final"):
 *   p12: heads with the JOB NAME as its title, has the plain-English deal
 *        section, the job details, and the contract value block.
 *   p14 (04 SIGN HERE):
 *        "By signing below, <client> agrees to everything above."
 *        CONTRACTOR column: business name, "By: <person>", "Date: <date>"
 *        CUSTOMER column: "Sign & type name below"
 */
describe("public contract — document anatomy + signature block", () => {
  const PHONE = "+15125550941";
  let contractId: string;

  before(() => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "en");
    cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "en" }); // fresh users default to es; EN copy asserted
    cy.apiUpdateProfile({ businessName: "HANS LLC" });
    cy.apiUpdateUser({ name: "Hans Pedersen" });
    cy.seedQuoteToCash({
      quote: {
        jobName: "Backyard Junk Removal",
        description: "Removing junk from a backyard and making sure no trash remains",
      },
      customer: { name: "Green Goblin" },
    }).then(({ contractId: id }) => {
      contractId = id;
    });
  });

  beforeEach(() => {
    cy.clearCookies(); // customer view
    cy.setCookie("pm_lang", "en"); // EN copy asserted below (Spanish-first app)
    cy.visit(`/c/${contractId}`);
  });

  it("heads with the job name and shows the plain-English + value sections (p12)", () => {
    cy.contains(/backyard junk removal/i, { timeout: 10_000 }).should("be.visible");
    cy.contains(/plain english/i).should("be.visible");
    cy.contains(/job details/i).should("be.visible");
    cy.contains(/contract value/i).should("be.visible");
  });

  it("carries the parties + effective-date line and the line-item table (p12 anatomy)", () => {
    // "Between <contractor> ('Contractor') and <client> ('Client') · effective <date>"
    cy.contains(/between .*contractor.*green goblin.*client/i, { timeout: 10_000 })
      .should("be.visible");
    cy.contains(/effective/i).should("be.visible");
    // DESCRIPTION / AMOUNT line-item table.
    cy.contains(/description/i).should("be.visible");
    cy.contains(/amount/i).should("be.visible");
  });

  it("the contract KEEPS its terms (the p6 exclusion applies to the invoice, not here)", () => {
    // Flip side of invoice-parity: the agreement still carries the terms
    // block (start / time to complete / payment / warranty).
    cy.contains(/start|schedule/i).should("exist");
    cy.contains(/payment/i).should("exist");
    cy.contains(/warranty/i).should("exist");
  });

  it("states 'By signing below, <client> agrees to everything above.' (p14)", () => {
    cy.contains(/by signing below,\s*green goblin agrees to everything above\./i)
      .should("be.visible");
  });

  it("contractor signature column shows the BUSINESS name with 'By: <person>' and the date (p14)", () => {
    cy.contains(/contractor signature/i)
      .parents("section, div")
      .first()
      .within(() => {
        cy.contains("HANS LLC").should("be.visible");
        cy.contains(/by:\s*hans pedersen/i).should("be.visible");
        cy.contains(/date:/i).should("be.visible");
      });
  });

  it("customer signature column instructs 'Sign & type name below' (p14)", () => {
    cy.contains(/your signature/i)
      .parents("section, div")
      .first()
      .within(() => {
        cy.contains(/sign & type name below/i).should("be.visible");
      });
  });

  it("keeps the signature aids — Undo and Clear — from the current design (p14: 'Everything else the same')", () => {
    cy.contains(/sign & type name below/i)
      .parents("section, div")
      .first()
      .within(() => {
        cy.contains("button", /undo/i).should("exist");
        cy.contains("button", /clear/i).should("exist");
      });
  });

  it("typing a name and signing completes the agreement", () => {
    cy.contains(/sign & type name below/i)
      .parents("section, div")
      .first()
      .find("input, [contenteditable]")
      .first()
      .type("Green Goblin");
    cy.contains("button", /^sign|firmar/i).click();
    cy.contains(/signed|firmado|thank/i, { timeout: 10_000 }).should("be.visible");
  });
});
