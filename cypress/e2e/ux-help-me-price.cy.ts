/// <reference types="cypress" />

/**
 * UX-41 (affordance + overlap nits) — "Help-me-price step nits."
 * (ux-problems.md; the ES-Title-Casing bullet of UX-41 belongs to slice D
 * and is NOT covered here.)
 *
 *   "The version-confirm step's ONLY advance affordance is the green strip
 *    'Se ve bien — confirma estos detalles', styled as a passive summary
 *    rather than a button (no Continuar exists — measured: nothing else
 *    advances); the 'Atrás'/heading overlap recurs on this card."
 *
 * Grounding (front-end/islands/AsstChat.tsx + front-end/static/
 * assistant-page.css, verified today):
 *   - Confirm mode renders ONLY the summary strip: the ternary at
 *     AsstChat.tsx:3950-3993 shows <button data-cy=confirm-details
 *     class="chat__confirm-details"> (label asstChat.confirmDetails.cta,
 *     es.json:172 "Se ve bien — confirma estos detalles") INSTEAD of the
 *     standard advance control button.chat__price-continue that every other
 *     step renders ("Continuar →", asstChat.continue). So a <button> DOES
 *     exist — the honest red is the missing standard button-styled advance
 *     control, pinned as .chat__price-continue on this step (the green
 *     agent may keep the summary strip; it must add the standard control).
 *   - The overlap: .chat__jobopts-head is position:relative with the back
 *     button .chat__price-back absolutely positioned at top:0 (css:8095-
 *     8112) while .chat__jobopts-title only has margin-top:2px (css:8470-
 *     8476 — compare .chat__price-title's 22px clearance, css:8117-8123).
 *     The two boxes intersect → the audit's "Atrás"/heading overlap.
 *
 * Flow driving mirrors cypress/e2e/quotes-help-me-price.cy.ts (chip → typed
 * details → [data-cy=confirm-details]) without duplicating its coverage
 * (that spec owns confirm-existence, 3+1 pricing options, and flow
 * continuation). ES persona — the audit's surface.
 *
 * Stub-LLM honesty: the job-options generation runs under the stub and
 * deterministically yields the 3-card picker + confirm strip (prior art
 * P-24 drove the same ES path).
 *
 * Phones used: +15125556430.
 */

// Module marker: keeps top-level declarations file-scoped so parallel spec
// files (which share the global script scope otherwise) don't collide.
export {};

const HELP_PRICE_CHIP = "Conozco el trabajo, ayúdame a ponerle precio.";
const DETALLES = "Cambiar 12 tablas del deck y sellar la superficie";

function loginEs(phone: string) {
  cy.clearCookies();
  cy.loginAs(phone);
  cy.apiUpdateUser({ language: "es" });
  cy.clearCookie("pm_lang");
  cy.request("POST", "/api/me/onboarded", { skipped: true });
}

describe("UX-41 help-me-price version-confirm step", () => {
  const PHONE = "+15125556430";

  beforeEach(() => {
    loginEs(PHONE);
    cy.visit("/assistant");
    cy.contains("button.chat__empty-prompt", HELP_PRICE_CHIP)
      .should("be.visible")
      .click();
    cy.get("textarea.composer__input", { timeout: 10_000 })
      .should("be.visible")
      .type(DETALLES);
    cy.get("button.composer__send").click();
    // The version-confirm step: 3 editable version cards + the green strip.
    cy.get("[data-cy=confirm-details]", { timeout: 20_000 }).should(
      "be.visible",
    );
  });

  it("UX-41 the confirm step has a real button-styled advance control, not only the summary strip", () => {
    // RED today: in confirm mode the standard advance button
    // (.chat__price-continue, "Continuar →") is NOT rendered — the ternary
    // at AsstChat.tsx:3950-3993 swaps it for the passive-looking
    // .chat__confirm-details strip, so nothing on the card LOOKS like the
    // button that advances every other step. Desired: the standard control
    // present, visible and enabled (the summary strip may stay).
    cy.get(".chat__jobopts .chat__price-continue")
      .should("be.visible")
      .and("not.be.disabled");
  });

  it("UX-41 no in-card 'Atrás' control on the picker head (single-back rule, 2026-08-19)", () => {
    // UX-41's original overlap finding is moot: the single-back rule
    // removed the in-card back control entirely (the header back undoes
    // this view via the shared resolver), so the card head must render
    // WITHOUT it — which also permanently resolves the overlap.
    cy.get(".chat__jobopts-head").should("be.visible");
    cy.get(".chat__jobopts-head .chat__price-back").should("not.exist");
    cy.get("[data-cy=wizard-back]").should("not.exist");
  });
});
