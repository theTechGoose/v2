/// <reference types="cypress" />

/**
 * REQ-039 — NW-52 (p58): "Delete scope: do not delete data, flag it as
 * 'deleted'. When someone signs up with the same phone number, offer to
 * create a new account or recover the old one."
 *
 * /verify on a phone that belonged to a closed account offers
 * [data-cy=recover-account] and [data-cy=start-fresh]; nothing signs in
 * behind the person's back. Dev master OTP 000000 (support/commands.ts).
 */
export {};

const PHONE = "+15125550992";

function typeMasterCode() {
  for (let i = 0; i < 6; i++) {
    cy.get("input[inputmode=numeric]").eq(i).type("0", { force: true });
  }
}

describe("REQ-039 NW-52 closed account → /verify offers recover or start fresh", () => {
  beforeEach(() => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "en");
    cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "en", name: "Old Owner" });
    cy.request("POST", "/api/me/onboarded", { skipped: true });
    cy.request({ method: "DELETE", url: "/api/me" }).its("status").should("eq", 200);
    cy.clearCookies();
    cy.setCookie("pm_lang", "en");
  });

  it("REQ-039 recover: the old account comes back with its name", () => {
    cy.visit(`/verify?phone=${encodeURIComponent(PHONE)}`);
    typeMasterCode();
    cy.get("[data-cy=recover-choice]", { timeout: 15_000 }).should("be.visible");
    cy.get("[data-cy=recover-account]").should("be.visible").click();
    cy.location("pathname", { timeout: 15_000 }).should("eq", "/dashboard");
    cy.request("/api/me").its("body.name").should("eq", "Old Owner");
  });

  it("REQ-039 start fresh: a brand-new account on the same number", () => {
    cy.visit(`/verify?phone=${encodeURIComponent(PHONE)}`);
    typeMasterCode();
    cy.get("[data-cy=recover-choice]", { timeout: 15_000 }).should("be.visible");
    cy.get("[data-cy=start-fresh]").should("be.visible").click();
    cy.location("pathname", { timeout: 15_000 }).should("match", /^\/(assistant|welcome)/);
    cy.request("/api/me").its("body.name").should("not.eq", "Old Owner");
  });
});
