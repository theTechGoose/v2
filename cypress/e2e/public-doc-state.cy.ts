/// <reference types="cypress" />

/**
 * Public document state — persisted acceptance, customer naming, signature
 * rendering, and post-signed affordances. All on /q/:id: the quote IS the
 * agreement (one document, one signature ceremony — the old /c page is
 * gone).
 *
 *   P-11 "The public quote has no persisted accepted state." — a reloaded
 *        accepted /q/:id must render the persisted signed state (who, when),
 *        with no fresh signature ceremony and no active decline.
 *   P-13 "The agreement never names the customer: 'Para: —'." — /q/:id must
 *        render the customer's name in the To/Para party card, before AND
 *        after signing.
 *   P-40 "The drawn signature is captured, stored… and never shown." — the
 *        accepted /q/:id must render the stored signature image.
 *   P-63 "Signed agreement has no PDF download; footer still asks
 *        '¿Preguntas antes de firmar?'; the question flow hides the actions
 *        until reload." — accepted /q offers a PDF + post-signed footer
 *        copy; an open /q keeps the ceremony AND Decline available after
 *        sending a question.
 *
 * EN copy is asserted (pm_lang=en cookie, language:"en" user) — the exact
 * strings come from lang/en.json; the matching es.json strings are noted
 * where the audit quoted them ("¿Preguntas antes de firmar?" ⇔ "Questions
 * before signing?", "Para" ⇔ "To").
 */

const CUSTOMER_NAME = "Maria Delgado";

/** Tiny valid 8×8 PNG data URL — the same shape PublicSignQuote submits. */
const SIGNATURE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAF0lEQVR4nGNgYGD4z4AGmNAFRlgIXQAAiMkBB9dzbnMAAAAASUVORK5CYII=";

// ---------------------------------------------------------------------------
// P-11 — /q/:id persisted accepted state
// ---------------------------------------------------------------------------

describe("P-11 public quote — persisted accepted state on reload", () => {
  const PHONE = "+15125552550";
  let quoteId: string;

  before(() => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "en");
    cy.loginAs(PHONE);
    cy.request("POST", "/api/me/onboarded", { skipped: true });
    cy.apiUpdateUser({ language: "en", name: "Hans Pedersen" });
    cy.apiUpdateProfile({ businessName: "HANS LLC" });
    cy.apiCreateCustomer({
      name: CUSTOMER_NAME,
      email: "maria.cy@blackhole.postmarkapp.com",
      phoneNumber: "+15125552551",
    }).then((customerId: string) => {
      cy.apiCreateQuote({
        summary: "Removing junk from a backyard",
        jobName: "Backyard Junk Removal",
        lineItems: [
          {
            description: "Junk removal",
            quantity: 1,
            unit: "job",
            price: 55000,
          },
        ],
        estimatedTotal: 55000,
        customerId,
      }).then((id: string) => {
        quoteId = id;
        // María accepts once — the server records status "accepted" + the
        // signature metadata (who/when).
        cy.apiAcceptQuote(quoteId, {
          name: CUSTOMER_NAME,
          signature: CUSTOMER_NAME,
        }).its("status").should("be.lessThan", 400);
      });
    });
  });

  beforeEach(() => {
    cy.clearCookies(); // customer context — no contractor session
    cy.setCookie("pm_lang", "en");
    cy.visit(`/q/${quoteId}`);
    cy.contains(/backyard junk removal/i, { timeout: 10_000 }).should(
      "be.visible",
    );
  });

  it("P-11 a fresh visit to an accepted quote renders the persisted signed state (who signed, when)", () => {
    // Terminal state must be visible without any in-session acceptance —
    // the "Signed {date}" pill + the "Signed and binding" strip.
    cy.contains(/signed and binding|firmado y vinculante/i, {
      timeout: 10_000,
    }).should("be.visible");
    // Who: the full accepted name (the signature card heading
    // "Maria Delgado Signature" and the To card both carry it).
    cy.contains(CUSTOMER_NAME).should("be.visible");
    // When: the acceptance date (at least its year) is rendered. \b-bounded
    // so a hex char run inside the #id slice can never satisfy it.
    cy.contains(new RegExp(`\\b${new Date().getFullYear()}\\b`)).should(
      "be.visible",
    );
  });

  it("P-11 the accepted page has no fresh signature ceremony and no active decline", () => {
    // The pristine pad + "type your name" form must NOT come back:
    cy.get("form.ctr__sign-form").should("not.exist");
    cy.get("canvas").should("not.exist");
    cy.get('input[placeholder="Jane Doe"]').should("not.exist");
    cy.contains("Type your full legal name").should("not.exist");
    cy.contains("button", /sign the contract/i).should("not.exist");
    // Decline must not be offered as an active action on a settled quote
    // (PublicQuoteActions renders only while pendingSignature):
    cy.contains("button", /^(Decline|Rechazar)$/).should("not.exist");
  });

  it("P-11 the confirmation survives a reload", () => {
    cy.contains(/signed and binding|firmado y vinculante/i, {
      timeout: 10_000,
    }).should("be.visible");
    cy.reload();
    cy.contains(/backyard junk removal/i, { timeout: 10_000 }).should(
      "be.visible",
    );
    cy.contains(/signed and binding|firmado y vinculante/i).should(
      "be.visible",
    );
    cy.contains(CUSTOMER_NAME).should("be.visible");
    cy.get("form.ctr__sign-form").should("not.exist");
    cy.get('input[placeholder="Jane Doe"]').should("not.exist");
  });
});

// ---------------------------------------------------------------------------
// P-13 / P-40 / P-63 — /q/:id customer naming, signature image, signed
// affordances. One agreement (quote) shared in file order.
// ---------------------------------------------------------------------------

describe("P-13 public agreement — names the customer in the To/Para card", () => {
  const PHONE = "+15125552560";

  before(() => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "en");
    cy.loginAs(PHONE);
    cy.request("POST", "/api/me/onboarded", { skipped: true });
    cy.apiUpdateUser({ language: "en", name: "Hans Pedersen" });
    cy.apiUpdateProfile({ businessName: "HANS LLC" });
    cy.apiCreateCustomer({
      name: CUSTOMER_NAME,
      email: "maria.contract.cy@blackhole.postmarkapp.com",
      phoneNumber: "+15125552561",
    }).then((customerId: string) => {
      cy.apiCreateQuote({
        summary: "Removing junk from a backyard",
        jobName: "Backyard Junk Removal",
        lineItems: [
          {
            description: "Junk removal",
            quantity: 1,
            unit: "job",
            price: 55000,
          },
        ],
        estimatedTotal: 55000,
        customerId,
      }).then((quoteId: string) => {
        // Shared with the P-40/P-63 describes below (runtime env survives
        // across describes within one spec run). The public payload must
        // resolve the linked customer (P-13).
        Cypress.env("pdsQuoteId", quoteId);
      });
    });
  });

  beforeEach(() => {
    cy.clearCookies(); // customer view
    cy.setCookie("pm_lang", "en");
  });

  it("P-13 BEFORE signing the To/Para card shows the customer's name, not '—'", () => {
    cy.visit(`/q/${Cypress.env("pdsQuoteId")}`);
    cy.contains(/backyard junk removal/i, { timeout: 10_000 }).should(
      "be.visible",
    );
    // lang/en.json quoteDoc.to = "To" (es: "Para") — the party card.
    cy.contains(/^(To|Para)$/, { timeout: 10_000 })
      .parent()
      .within(() => {
        cy.contains(CUSTOMER_NAME).should("be.visible");
        cy.contains("—").should("not.exist");
      });
  });

  it("P-13 AFTER signing the To/Para card still shows the customer's name", () => {
    // The one (real) accept-sign — carries the drawn-signature PNG P-40
    // asserts on. Accepting IS the signature ceremony.
    cy.apiAcceptQuote(Cypress.env("pdsQuoteId"), {
      signature: SIGNATURE_PNG,
      name: CUSTOMER_NAME,
    }).its("status").should("be.lessThan", 400);
    cy.visit(`/q/${Cypress.env("pdsQuoteId")}`);
    cy.contains(/backyard junk removal/i, { timeout: 10_000 }).should(
      "be.visible",
    );
    cy.contains(/^(To|Para)$/, { timeout: 10_000 })
      .parent()
      .within(() => {
        cy.contains(CUSTOMER_NAME).should("be.visible");
        cy.contains("—").should("not.exist");
      });
  });
});

describe("P-40 public agreement — signed page renders the drawn signature", () => {
  before(() => {
    // Guard only: ensure accepted even if P-13's flow didn't get there. A
    // second accept 409s (already_accepted) — either way the quote is
    // accepted afterwards, which is all P-40 needs (no status assertion).
    cy.apiAcceptQuote(Cypress.env("pdsQuoteId"), {
      signature: SIGNATURE_PNG,
      name: CUSTOMER_NAME,
    });
  });

  beforeEach(() => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "en");
    cy.visit(`/q/${Cypress.env("pdsQuoteId")}`);
    cy.contains(/backyard junk removal/i, { timeout: 10_000 }).should(
      "be.visible",
    );
  });

  it("P-40 the signed agreement shows the captured signature image", () => {
    // The stored PNG (a data URL today; a fetchable URL is also acceptable)
    // must actually render — the consent copy calls the drawing part of the
    // signature, so it cannot vanish after submit.
    cy.get(
      'img[src^="data:image"], img[src*="signature"]',
      { timeout: 10_000 },
    )
      .should("exist")
      .first()
      .should(($img) => {
        const img = $img[0] as HTMLImageElement;
        expect(img.naturalWidth, "signature image decoded (naturalWidth)").to
          .be.greaterThan(0);
      });
  });
});

describe("P-63 signed-agreement affordances + open-quote question flow", () => {
  const PHONE = "+15125552560";
  let openQuoteId: string;

  before(() => {
    // A fresh OPEN quote for the ask-a-question flow (the P-11 quote and
    // the P-13 agreement are already accepted).
    cy.clearCookies();
    cy.setCookie("pm_lang", "en");
    cy.loginAs(PHONE);
    cy.apiCreateCustomer({
      name: CUSTOMER_NAME,
      email: "maria.ask.cy@blackhole.postmarkapp.com",
      phoneNumber: "+15125552562",
    }).then((customerId: string) => {
      cy.apiCreateQuote({
        summary: "Removing junk from a backyard",
        jobName: "Backyard Junk Removal",
        lineItems: [
          {
            description: "Junk removal",
            quantity: 1,
            unit: "job",
            price: 55000,
          },
        ],
        estimatedTotal: 55000,
        customerId,
      }).then((id: string) => {
        openQuoteId = id;
      });
    });
  });

  beforeEach(() => {
    cy.clearCookies(); // customer view
    cy.setCookie("pm_lang", "en");
  });

  it("P-63 the signed /q offers a PDF download (the invoice already does)", () => {
    cy.visit(`/q/${Cypress.env("pdsQuoteId")}`);
    cy.contains(/backyard junk removal/i, { timeout: 10_000 }).should(
      "be.visible",
    );
    // Invoice precedent: /i renders <a href="/api/invoices/:id/pdf">. The
    // signed agreement exposes the equivalent (/api/quotes/:id/pdf via
    // deriveQuoteView.pdfUrl).
    cy.get(`a[href*="/api/quotes/${Cypress.env("pdsQuoteId")}/pdf"]`, {
      timeout: 10_000,
    }).should("exist");
  });

  it("P-63 the signed /q footer stops asking questions 'before signing'", () => {
    cy.visit(`/q/${Cypress.env("pdsQuoteId")}`);
    cy.contains(/backyard junk removal/i, { timeout: 10_000 }).should(
      "be.visible",
    );
    // Wait until the signed state is on screen, then pin the footer copy.
    cy.contains(/signed and binding|firmado y vinculante/i, {
      timeout: 10_000,
    }).should("be.visible");
    // lang/en.json quoteDoc.qBefore = "Questions before signing?"
    // lang/es.json quoteDoc.qBefore = "¿Preguntas antes de firmar?"
    cy.contains("Questions before signing?").should("not.exist");
    cy.contains("¿Preguntas antes de firmar?").should("not.exist");
  });

  it("P-63 sending a question on /q keeps the ceremony AND Decline available without a reload", () => {
    cy.visit(`/q/${openQuoteId}`);
    cy.contains(/backyard junk removal/i, { timeout: 10_000 }).should(
      "be.visible",
    );
    // Open the ask form and send a question (lang/en.json strings).
    cy.contains("button", "Ask a question").click();
    cy.get("textarea").first().type("Does the price include haul-away?");
    cy.contains("button", "Send question").click();
    cy.contains("Question sent", { timeout: 10_000 }).should("be.visible");
    // WITHOUT reloading, the quote is still open and actionable: the one
    // signature ceremony (the pad form) and the Decline action both remain.
    cy.get("form.ctr__sign-form").should("exist");
    cy.contains("button", /^(Decline|Rechazar)$/).should("exist");
  });
});
