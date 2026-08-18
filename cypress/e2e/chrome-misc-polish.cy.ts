/// <reference types="cypress" />

/**
 * P-65 [POLISH] Chrome/misc: <html lang> must match the user's language; the
 *      dev route /test must 404; the ES dashboard date line must start with a
 *      capital; the ES danger-zone confirm keyword must be localized (not
 *      "DELETE").
 * P-59 [I18N] The "Monster tip" body must be localized in ES (not the English
 *      "…within the first 48 hours…" fallback); the EN dashboard activity feed
 *      must not show frozen Spanish event prose.
 */

describe("chrome + misc polish (P-65)", () => {
  const PHONE = "+15125553120";

  function login(lang: "es" | "en") {
    cy.clearCookies();
    cy.loginAs(PHONE);
    cy.request("POST", "/api/me/onboarded", { skipped: true });
    cy.apiUpdateUser({ language: lang });
    cy.clearCookie("pm_lang"); // let the user's language win
  }

  it("P-65 <html lang> matches the user's language", () => {
    login("es");
    cy.visit("/dashboard");
    cy.contains(/cotizaciones|facturas|clientes/i, { timeout: 10_000 }).should("be.visible");
    cy.document().its("documentElement.lang").should("eq", "es");

    cy.apiUpdateUser({ language: "en" });
    cy.clearCookie("pm_lang");
    cy.visit("/dashboard");
    cy.contains(/quotes|invoices|clients/i, { timeout: 10_000 }).should("be.visible");
    cy.document().its("documentElement.lang").should("eq", "en");
  });

  it("P-65 the dev route /test returns 404 (must not ship)", () => {
    cy.request({ url: "/test", failOnStatusCode: false }).its("status").should("eq", 404);
  });

  it("P-65 the ES dashboard date line starts with a capital", () => {
    login("es");
    cy.visit("/dashboard");
    // Ensure the ES flip has happened (shared langSignal) before reading the date.
    cy.contains(/cotizaciones|facturas|clientes/i, { timeout: 10_000 }).should("be.visible");
    cy.get(".topbar__greet-line", { timeout: 10_000 }).invoke("text").then((t) => {
      const first = t.trim().charAt(0);
      expect(first, "ES date line first character is uppercase").to.match(/[A-ZÁÉÍÓÚÑ]/);
    });
  });

  it("P-65 the ES danger-zone confirm keyword is localized (not 'DELETE')", () => {
    login("es");
    cy.visit("/settings");
    cy.contains(".panel", /zona de peligro/i, { timeout: 10_000 })
      .should("not.contain", "DELETE");
  });
});

describe("Monster tip is localized in ES (P-59)", () => {
  const PHONE = "+15125553121";

  it("P-59 the ES quotes tip is not the English '…within the first 48 hours…' fallback", () => {
    cy.clearCookies();
    cy.loginAs(PHONE);
    cy.request("POST", "/api/me/onboarded", { skipped: true });
    cy.apiUpdateUser({ language: "es" }); // fresh (0 quotes) → static fallback
    cy.clearCookie("pm_lang");

    // Assert on the insight the tip renders — deterministic (no DOM race). The
    // fix must localize ComputeQuoteInsight's static fallback for the viewer.
    cy.intercept("GET", "**/analytics/quotes/insight").as("insight");
    cy.visit("/quotes");
    cy.wait("@insight").its("response.body.text")
      .should("not.match", /within the first 48 hours/i);
  });
});

describe("activity feed follows the viewer's language (P-59)", () => {
  const PHONE = "+15125553122";

  it("P-59 the ES dashboard feed shows no frozen English event prose", () => {
    // The public-accept event materializes its notification in English by
    // default (notify-on-event: event.data.language ?? "en"), so a Spanish
    // viewer sees "… accepted your quote" — the reverse-leak this pins.
    cy.clearCookies();
    cy.loginAs(PHONE);
    cy.request("POST", "/api/me/onboarded", { skipped: true });
    cy.apiUpdateUser({ language: "es" }); // viewer is Spanish
    cy.apiCreateCustomer({
      name: "Green Goblin",
      email: "goblin.p59@blackhole.postmarkapp.com",
      phoneNumber: "5125553151",
    }).then((customerId: string) => {
      cy.apiCreateQuote({
        summary: "Fence repair",
        jobName: "Fence Repair",
        lineItems: [{ description: "Fence repair", quantity: 1, unit: "ea", price: 35000 }],
        estimatedTotal: 35000,
        customerId,
      }).then((quoteId: string) => {
        // Public (anonymous) accept → creates the frozen-language notification.
        cy.clearCookies();
        cy.request({
          method: "POST",
          url: `/api/quotes/${quoteId}/accept`,
          body: { signature: "Green Goblin", name: "Green Goblin" },
          failOnStatusCode: false,
        });
      });
    });

    // Re-auth as the Spanish viewer and open the feed.
    cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "es" });
    cy.clearCookie("pm_lang"); // let the user's Spanish win
    cy.visit("/dashboard");

    cy.get("#activity", { timeout: 10_000 }).within(() => {
      cy.contains("Green Goblin"); // the seeded event surfaced in the feed
      cy.root()
        .should("not.contain", "accepted your quote")
        .and("not.contain", "signed the contract");
    });
  });
});
