/// <reference types="cypress" />

/**
 * PDF p10 — the quote badge must walk Draft → Sent → Viewed → Accepted:
 *  "If it is Sent lets have that change to 'Sent' and then 'Viewed' and then
 *   accepted once they sign." (Canonical status value is "accepted" — the
 *   legacy "approved" is dead; quotesPage.status.accepted renders
 *   "Accepted".)
 *
 * Contract selector: [data-cy=quote-status-badge] on the quote card/detail.
 * "Viewed" is triggered by the CUSTOMER opening the public quote (a
 * cookie-less request) — an owner's own view must not count.
 */
describe("quote status badge lifecycle", () => {
  const PHONE = "+15125550924";
  let quoteId: string;

  before(() => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "en");
    cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "en" }); // fresh users default to es; EN copy asserted
    cy.apiCreateCustomer({
      name: "Green Goblin",
      email: "green.badge@blackhole.postmarkapp.com",
      phoneNumber: "+15125550925",
    }).then((customerId) => {
      cy.apiCreateQuote({
        customerId,
        summary: "Removing junk from a backyard",
        jobName: "Backyard Junk Removal",
        lineItems: [{
          description: "Junk removal",
          quantity: 1,
          unit: "job",
          price: 55000,
        }],
        estimatedTotal: 55000,
      }).then((id) => {
        quoteId = id;
      });
    });
  });

  beforeEach(() => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "en"); // re-pin EN after the wipe (Spanish-first app)
    cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "en" }); // fresh users default to es; EN copy asserted
  });

  function badgeText() {
    cy.visit(`/quotes?open=${quoteId}`);
    return cy.get("[data-cy=quote-status-badge]", { timeout: 10_000 }).invoke(
      "text",
    );
  }

  /** Simulate the CUSTOMER opening the public quote: no session cookies. */
  function customerOpensQuote() {
    cy.clearCookies();
    cy.request(`/api/quotes/${quoteId}/public`);
    cy.setCookie("pm_lang", "en");
    cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "en" }); // fresh users default to es; EN copy asserted
  }

  it("starts as DRAFT", () => {
    badgeText().should("match", /draft/i);
  });

  it("flips to SENT after sending", () => {
    cy.apiSendQuoteEmail(quoteId);
    badgeText().should("match", /sent/i);
  });

  it("flips to VIEWED once the customer opens the public quote", () => {
    customerOpensQuote();
    badgeText().should("match", /viewed/i);
  });

  it("flips to ACCEPTED once the customer signs", () => {
    cy.apiAcceptQuote(quoteId, {
      signature: "Green Goblin",
      name: "Green Goblin",
    });
    badgeText().should("match", /accepted/i);
  });

  it("never regresses after acceptance — a later view keeps it ACCEPTED", () => {
    customerOpensQuote();
    badgeText().should("match", /accepted/i);
  });
});

// ===========================================================================
// REQ-003 — NW-10 (p8): "The Quote + Agreement card shows a 'SENT' badge in
// the top right before I have actually sent it." The price flow must create
// the quote as a DRAFT; only a real dispatch flips it to sent.
// ===========================================================================
describe("REQ-003 NW-10 the price flow creates a draft", () => {
  const PHONE = "+15125550926";
  const KNOWN_PRICE_CHIP = "Sé mi precio, redáctalo.";

  beforeEach(() => {
    cy.clearCookies();
    cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "es" });
    cy.clearCookie("pm_lang");
    cy.request("POST", "/api/me/onboarded", { skipped: true });
  });

  it("REQ-003 NW-10 after Continue on the price step the newest quote is 'draft', not 'sent'", () => {
    cy.visit("/assistant");
    cy.contains("button.chat__empty-prompt", KNOWN_PRICE_CHIP)
      .should("be.visible")
      .click();
    cy.get("textarea.composer__input", { timeout: 10_000 })
      .should("be.visible")
      .type("Pintar una cerca de madera de 50 pies");
    cy.get("button.composer__send").click();
    cy.get(".chat__price-capture", { timeout: 10_000 }).should("be.visible");
    cy.get(".chat__price-capture input.mi__input").type("500");
    cy.get("button.chat__price-continue").should("not.be.disabled").click();
    cy.location("pathname", { timeout: 20_000 }).should("match", /^\/assistant\/.+/);

    cy.request("/api/quotes").then((res) => {
      const rows = res.body as Array<{ status?: string; createdAt?: string; sentAt?: string }>;
      expect(rows.length, "a quote was created").to.be.greaterThan(0);
      const newest = [...rows].sort((a, b) =>
        String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""))
      )[0];
      expect(newest.status, `newest quote status`).to.eq("draft");
      expect(newest.sentAt, "sentAt").to.be.undefined;
    });
  });
});
