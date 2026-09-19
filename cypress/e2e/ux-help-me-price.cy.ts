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

// ===========================================================================
// REQ-010 — NW-17 (p26): "The chip at the bottom reads 'I know the job, help
// me price it.Write it myself'. Needs a space after the period and a period
// at the end of 'myself'." The pill ends with a period and sits on its own
// line, with a visible gap under the prompt bubble.
// ===========================================================================
describe("REQ-010 NW-17 the 'Write it myself.' pill", () => {
  const PHONE = "+15125556431";

  beforeEach(() => {
    loginEs(PHONE);
    cy.visit("/assistant");
    cy.contains("button.chat__empty-prompt", HELP_PRICE_CHIP)
      .should("be.visible")
      .click();
    cy.get(".chat__details-prompt-bubble", { timeout: 10_000 }).should("be.visible");
  });

  it("REQ-010 NW-17 ends with a period and has breathing room under the bubble", () => {
    cy.get(".chat__details-writeself").should("be.visible").invoke("text").then((raw) => {
      const text = String(raw).replace(/\s+/g, " ").trim();
      expect(text, "pill copy").to.match(/Escribirlo yo mismo\.$/);
    });
    cy.get(".chat__details-prompt-bubble").then(($bubble) => {
      const bubble = $bubble[0].getBoundingClientRect();
      cy.get(".chat__details-writeself").then(($pill) => {
        const pill = $pill[0].getBoundingClientRect();
        expect(pill.top, "pill starts below the bubble").to.be.at.least(bubble.bottom);
        expect(pill.top - bubble.bottom, "gap under the bubble (px)").to.be.at.least(8);
      });
    });
  });
});

// ===========================================================================
// REQ-027 — NW-11 (p20): "Confirm the 'Confirm your job details' page is
// working correctly. (Screenshot: the three options are the raw text
// verbatim.)" The picker used to paint a client-side echo of the sentence
// BEFORE the request and silently swap in the model's cards. Now it waits
// with the "Writing up your options…" dots, and a failed request lands on
// honest scope bullets (never the sentence), a visible "couldn't draft" note,
// and the "Write it myself" tile prefilled with the contractor's own words.
// ===========================================================================
describe("REQ-027 NW-11 the picker waits for the model and never paints the sentence", () => {
  const PHONE = "+15125556432";
  const SENTENCE = "Necesito cambiar 12 tablas del deck por $900";
  const OPTIONS_URL = "/api/agents/job-details/options";

  function startHelpMePrice() {
    cy.visit("/assistant");
    cy.contains("button.chat__empty-prompt", HELP_PRICE_CHIP)
      .should("be.visible")
      .click();
    cy.get("textarea.composer__input", { timeout: 10_000 })
      .should("be.visible")
      .type(SENTENCE);
    cy.get("button.composer__send").click();
  }

  beforeEach(() => {
    loginEs(PHONE);
  });

  it("REQ-027 (a) the dots show first — no card is painted before the model answers", () => {
    cy.intercept("POST", OPTIONS_URL, (req) => {
      req.continue((res) => {
        res.setDelay(1500);
      });
    }).as("options");
    startHelpMePrice();
    // While the request is in flight: the honest wait, and no card at all.
    cy.get(".chat__jobopts-loading").should("be.visible");
    cy.get(".chat__jobopt").should("not.exist");
    cy.wait("@options");
    cy.get("[data-cy=confirm-details]", { timeout: 20_000 }).should("be.visible");
    cy.get(".chat__jobopts-loading").should("not.exist");
  });

  it("REQ-027 (b) a failed request → honest bullets, a visible note, 'Write it myself' prefilled — never the sentence", () => {
    cy.intercept("POST", OPTIONS_URL, { statusCode: 500, body: { error: "boom" } }).as("options");
    startHelpMePrice();
    cy.wait("@options");
    cy.get("[data-cy=jobopts-degraded]", { timeout: 10_000 })
      .should("be.visible")
      .and("contain.text", "No pude redactar esto");
    // Three cards, none of them the typed sentence; the scope is derived.
    cy.get(".chat__jobopt").should("have.length", 3);
    cy.get(".chat__jobopt-bullet").should("have.length.at.least", 3).each(($li) => {
      expect($li.text(), "a bullet echoes the sentence").not.to.include(SENTENCE);
      expect($li.text(), "a bullet carries the price").not.to.include("$900");
    });
    cy.get(".chat__jobopt").first().should("contain.text", "Cambiar 12 tablas del deck");
    cy.get(".chat__jobopt-name").first().should("not.match", /^Necesito/);
    // The contractor's own words wait in the "Write it myself" tile.
    cy.get(".chat__jobopt-custom").click();
    cy.get(".chat__jobopt-custom-area").should("have.value", SENTENCE);
    cy.get("[data-cy=confirm-details]").should("be.visible");
  });
});
