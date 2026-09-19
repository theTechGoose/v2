/// <reference types="cypress" />

/**
 * REQ-002 — NW-01 (PDF p2): "The toggle at the top should read
 * 'Yo hablo Espanol | I speak English', with 'Yo hablo Espanol' selected
 * by default."
 *
 * Default language is already Spanish; this spec pins the ORDER: the
 * Spanish button is the first child of the toggle and highlighted on a
 * fresh browser (no pm_lang cookie).
 */

describe("REQ-002 NW-01 landing language toggle — Spanish first", () => {
  beforeEach(() => {
    cy.clearCookies();
    cy.visit("/");
  });

  it("REQ-002 the first toggle button is Spanish, selected, labelled 'Yo hablo Español'", () => {
    cy.get(".lang-toggle button").first()
      .should("have.attr", "data-lang", "es")
      .and("have.class", "on")
      .and("contain", "Yo hablo Español");
  });

  it("REQ-002 the second toggle button is English, labelled 'I speak English'", () => {
    cy.get(".lang-toggle button").eq(1)
      .should("have.attr", "data-lang", "en")
      .and("contain", "I speak English");
  });
});
