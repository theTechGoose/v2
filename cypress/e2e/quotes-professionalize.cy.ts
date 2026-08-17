/// <reference types="cypress" />

/**
 * PDF p5 — "Write it myself" needs a "Professionalize that" action.
 *
 *  "When I put stuff in there it just took exactly what I said and that was
 *   it. It needs to break it down and make it professional and give the
 *   person the ability to accept or edit it."
 *
 * Contract selectors: [data-cy=professionalize-btn],
 * [data-cy=professionalize-proposal], [data-cy=professionalize-accept],
 * [data-cy=professionalize-edit].
 */
describe("write-it-myself — Professionalize that", () => {
  const PHONE = "+15125550922";
  const RAW = "tear out the old fence\nput up new panels\nhaul away the junk";

  beforeEach(() => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "en"); // re-pin EN after the wipe (Spanish-first app)
    cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "en" }); // fresh users default to es; EN copy asserted
    cy.request("POST", "/api/me/onboarded", { skipped: true }); // skip the /welcome trap for fresh users
    cy.visit("/assistant");
    cy.contains("button.chat__empty-prompt", "I know my price, write it up.").click();
    // Open the "Write it myself" option on the job-details step.
    cy.contains(/write it myself/i, { timeout: 10_000 }).click();
  });

  it("shows a 'Professionalize that' button once the user has typed details", () => {
    cy.get("textarea").filter(":visible").first().type(RAW);
    cy.get("[data-cy=professionalize-btn]")
      .should("be.visible")
      .and("contain.text", "Professionalize");
  });

  it("professionalizing proposes a polished breakdown WITHOUT replacing the user's text yet", () => {
    cy.get("textarea").filter(":visible").first().type(RAW);
    cy.get("[data-cy=professionalize-btn]").click();

    // A proposal appears…
    cy.get("[data-cy=professionalize-proposal]", { timeout: 15_000 })
      .should("be.visible");
    // …that is not a verbatim echo of the raw input…
    cy.get("[data-cy=professionalize-proposal]").invoke("text").then((text) => {
      expect(text.trim().toLowerCase()).not.to.equal(RAW.toLowerCase());
    });
    // …and the user's own words are still in the textarea (nothing replaced
    // until they accept).
    cy.get("textarea").filter(":visible").first()
      .invoke("val").should("contain", "tear out the old fence");
  });

  it("Accept applies the professional version to the job details", () => {
    cy.get("textarea").filter(":visible").first().type(RAW);
    cy.get("[data-cy=professionalize-btn]").click();
    cy.get("[data-cy=professionalize-proposal]", { timeout: 15_000 }).should("be.visible");

    cy.get("[data-cy=professionalize-proposal]").invoke("text").then((proposal) => {
      // Anchor on a distinctive fragment of the proposal so we can prove the
      // ACCEPTED value corresponds to it (not blanked, not garbage).
      const fragment = proposal.trim().split("\n")[0].trim().slice(0, 25);
      expect(fragment.length, "proposal has substance").to.be.greaterThan(5);

      cy.get("[data-cy=professionalize-accept]").click();
      cy.get("textarea").filter(":visible").first().invoke("val").then((val) => {
        expect(String(val), "applied details come FROM the proposal").to.contain(fragment);
        expect(String(val).toLowerCase()).not.to.equal(RAW.toLowerCase());
      });
    });
  });

  it("Edit lets the user modify the proposal before it is applied", () => {
    cy.get("textarea").filter(":visible").first().type(RAW);
    cy.get("[data-cy=professionalize-btn]").click();
    cy.get("[data-cy=professionalize-proposal]", { timeout: 15_000 }).should("be.visible");

    cy.get("[data-cy=professionalize-edit]").click();
    // Proposal becomes editable; append a custom line, then accept.
    cy.focused().type("\nDispose of debris at licensed facility");
    cy.get("[data-cy=professionalize-accept]").click();

    cy.get("textarea").filter(":visible").first()
      .invoke("val").should("contain", "licensed facility");
  });
});
