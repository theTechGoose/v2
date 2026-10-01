/// <reference types="cypress" />

/**
 * REQ-050 — "i want to make a new login-internal route that will allow me to
 * log in with email."
 *
 * /login-internal takes an email; the code goes to the address on an
 * address (any well-formed one); /verify-internal takes the code (the dev
 * master code 000000 here) and opens the session — the account that carries
 * the address, or a brand-new one.
 */
const PHONE = "+15125550981";
const EMAIL = "login-internal.cypress@blackhole.postmarkapp.com";

describe("REQ-050 /login-internal — log in with email", () => {
  beforeEach(() => {
    cy.clearCookies();
    // The account email login finds: made the way every account is (phone),
    // the address put on the record, then signed out.
    cy.loginAs(PHONE);
    cy.apiUpdateUser({ email: EMAIL });
    cy.request("POST", "/api/auth/logout");
    cy.clearCookies();
    cy.setCookie("pm_lang", "en");
  });

  it("REQ-050 the page asks for an email, not a phone", () => {
    cy.visit("/login-internal");
    cy.get("[data-cy=internal-email]").should("be.visible").and(
      "have.attr",
      "type",
      "email",
    );
    cy.get("input[type=tel]").should("not.exist");
  });

  it("REQ-050 an account with that email on file logs in with the emailed code", () => {
    cy.visit("/login-internal");
    cy.get("[data-cy=internal-email]").type(EMAIL);
    cy.get("[data-cy=internal-submit]").click();
    cy.location("pathname", { timeout: 15_000 }).should(
      "eq",
      "/verify-internal",
    );
    cy.location("search").should("contain", encodeURIComponent(EMAIL));
    cy.contains(EMAIL).should("be.visible");
    cy.get("input[inputmode=numeric]", { timeout: 10_000 }).should(
      "have.length",
      6,
    );
    for (let i = 0; i < 6; i++) {
      cy.get("input[inputmode=numeric]").eq(i).type("0", { force: true });
    }
    cy.location("pathname", { timeout: 20_000 }).should("eq", "/dashboard");
    cy.request("/api/me").its("body.email").should("eq", EMAIL);
  });

  it("REQ-050 an email no account has yet just creates the account and signs in", () => {
    const email = `new-${Date.now()}@blackhole.postmarkapp.com`;
    cy.visit("/login-internal");
    cy.get("[data-cy=internal-email]").type(email);
    cy.get("[data-cy=internal-submit]").click();
    cy.location("pathname", { timeout: 15_000 }).should(
      "eq",
      "/verify-internal",
    );
    cy.get("input[inputmode=numeric]", { timeout: 10_000 }).should(
      "have.length",
      6,
    );
    for (let i = 0; i < 6; i++) {
      cy.get("input[inputmode=numeric]").eq(i).type("0", { force: true });
    }
    cy.location("pathname", { timeout: 20_000 }).should("eq", "/welcome");
    cy.request("/api/me").then((r) => {
      expect(r.body.email).to.eq(email);
      expect(r.body.phoneNumber, "no made-up phone").to.eq("");
    });
  });
});
