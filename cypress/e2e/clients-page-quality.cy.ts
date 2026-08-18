/// <reference types="cypress" />

/**
 * P-34 [CLIENTS] the /clients headline + card metadata must be grammatical
 *      Spanish: no "Las uno persona …", no "sin contacto clientes" (wrong noun
 *      order), no "00 días" leading-zero badge.
 * P-64 [POLISH] phone rendered through one formatter (tel: href starts tel:+1);
 *      no "Dirección en archivo" claimed for an address-less client.
 * P-46 [I18N] EN: the customers page and its "Customers" nav must use ONE term
 *      (no client/customer mixing).
 */

const RAW_PHONE = "5125553150"; // deliberately un-normalized (→ +15125553150)

describe("clients page quality — ES headline, phone, address (P-34, P-64)", () => {
  const PHONE = "+15125553110";

  beforeEach(() => {
    cy.clearCookies();
    cy.loginAs(PHONE);
    // Reset to a clean slate so the header renders EXACTLY one client
    // ("uno persona"): /me/wipe nukes the user + data and kills the session,
    // so re-login recreates a fresh user.
    cy.request({ url: "/api/me/wipe", failOnStatusCode: false });
    cy.loginAs(PHONE);
    cy.request("POST", "/api/me/onboarded", { skipped: true });
    cy.apiUpdateUser({ language: "es" });
    cy.clearCookie("pm_lang"); // let the user's Spanish win

    // Exactly ONE customer, with a raw phone and NO address, plus a quote so
    // the analytics card reliably renders.
    cy.apiCreateCustomer({
      name: "Green Goblin",
      email: "goblin.p34@blackhole.postmarkapp.com",
      phoneNumber: RAW_PHONE,
    }).then((customerId: string) => {
      cy.apiCreateQuote({
        summary: "Removing junk from a backyard",
        jobName: "Backyard Junk Removal",
        description: "Junk haul-away",
        lineItems: [{ description: "Junk removal", quantity: 1, unit: "job", price: 55000 }],
        estimatedTotal: 55000,
        customerId,
      });
    });

    cy.visit("/clients");
    // Wait for the Spanish island render (add button copy is a fix-independent
    // ES marker) before asserting on the editorial header.
    cy.contains(".ph2__cta", "Nuevo cliente", { timeout: 10_000 }).should("be.visible");
    cy.get(".ccard2", { timeout: 10_000 }).should("have.length.at.least", 1);
  });

  it("P-34 the one-client headline is not 'Las uno persona …'", () => {
    cy.get(".ph2__title").invoke("text").should("not.match", /uno persona/i);
  });

  it("P-34 the header sub uses 'clientes sin contacto', not 'sin contacto clientes'", () => {
    cy.get(".ph2__sub").invoke("text").should("not.contain", "sin contacto clientes");
  });

  it("P-34 the since badge does not render a '00' leading-zero count", () => {
    cy.get(".ccard2__since-num").first().invoke("text").then((t) => {
      expect(t.trim(), "since-badge number").not.to.eq("00");
    });
  });

  it("P-34 relative time is localized, not raw English ('just now' / 'Xm ago')", () => {
    // A freshly-seeded card is "just now"; older ones are "Nm ago" — both are
    // the backend's English relativeTime leaking into the Spanish UI.
    cy.get(".ccard2__seg").first().invoke("text").then((t) => {
      expect(t, "ES relative time is not English").not.to.match(/\bago\b/i);
      expect(t, "ES relative time is not English 'just now'").not.to.contain("just now");
    });
  });

  it("P-34 the card story has no untranslated '· active.' suffix", () => {
    cy.get(".ccard2__story").first().invoke("text").should("not.contain", "· active");
  });

  it("P-64 the phone tel: href is normalized to +1", () => {
    cy.get('a[href^="tel:"]').first().should("have.attr", "href").and("match", /^tel:\+1/);
  });

  it("P-64 no 'Dirección en archivo' is claimed for an address-less client", () => {
    cy.get("body").should("not.contain", "Dirección en archivo");
  });
});

describe("clients page naming — one EN term across page and nav (P-46)", () => {
  const PHONE = "+15125553111";

  beforeEach(() => {
    cy.clearCookies();
    cy.loginAs(PHONE);
    // Clean slate so /clients shows the empty state (nav "Customers" vs the
    // "No clients yet" board is where the term drift is visible).
    cy.request({ url: "/api/me/wipe", failOnStatusCode: false });
    cy.setCookie("pm_lang", "en"); // Spanish-first app: re-pin EN
    cy.loginAs(PHONE);
    cy.request("POST", "/api/me/onboarded", { skipped: true });
    cy.apiUpdateUser({ language: "en" }); // no seeded customers → empty state
    cy.visit("/clients");
  });

  it("P-46 the page copy and the 'Customers' nav use the same term", () => {
    // Wait for the (fix-independent) empty board to render.
    cy.get(".ccards2__empty", { timeout: 10_000 }).should("exist");

    cy.get('a[href="/customers"]').first().invoke("text").then((navText) => {
      cy.get(".ph2__title, .ccards2__empty").invoke("text").then((pageText) => {
        const navCustomer = /\bcustomers?\b/i.test(navText);
        const pageCustomer = /\bcustomers?\b/i.test(pageText);
        // Red today: nav "Customers" (true) vs page "…clients…" (false).
        expect(navCustomer, "nav and page agree on the customers/clients term").to.eq(
          pageCustomer,
        );
      });
    });
  });
});
