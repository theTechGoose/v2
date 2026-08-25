/// <reference types="cypress" />

/**
 * Dashboard/pipeline stats truth — RED (TDD) specs for problems.md:
 *
 *   P-14 "The user's first quote is misreported as WON. Minutes after sending
 *        (nobody signed), /quotes shows it under 'Decididas este mes — 1
 *        ganadas' with 'En espera: $0 · 0'; /dashboard simultaneously says
 *        'esperando firma — 1 enviadas · $850', and it already counts as
 *        '1 trabajo activo'."
 *   P-15 "The onboarding sample quote pollutes real pipeline stats. '/quotes'
 *        hero claims '$3,700 en trabajo en manos de los clientes' … fabricated
 *        open-tracking ('1 apertura, Today · 9:42am · iPhone'), English strings
 *        ('Not sent yet — finish writing, then ship it.', 'Drafting'), … and a
 *        leaked internal slug 'onboarding-sample-v1 · #8b778011'."
 *   P-36 "Money numbers contradict across pages. … 'Vence Sin fecha de
 *        vencimiento' run-on (EN: 'Due No due date'); '$850' displayed as
 *        '$0.8k'; '1 activos'; 'Ver todo →' is a dead href='#'."
 *   P-37 "Giant empty-state hero shouts over real data — 'Todavía no hay nada
 *        en el pipeline. …' directly above an APROBADA card and 'Resueltas: 1'."
 *
 * All users are Spanish (the audited language). Each describe uses a FRESH
 * phone from the reserved +1512555270x/272x block and wipes it first
 * (GET /api/me/wipe) so counts are deterministic across reruns.
 */

/** login → wipe → login again → skip onboarding → Spanish UI. */
function freshSpanishUser(phone: string) {
  cy.clearCookies();
  cy.loginAs(phone);
  cy.request("/api/me/wipe");
  cy.loginAs(phone);
  cy.request("POST", "/api/me/onboarded", { skipped: true });
  cy.apiUpdateUser({ language: "es" });
  cy.clearCookie("pm_lang"); // let the user's language win
}

/** Re-login for a subsequent test (cookies are cleared between tests). */
function relogin(phone: string) {
  cy.clearCookies();
  cy.loginAs(phone);
  cy.request("POST", "/api/me/onboarded", { skipped: true });
  cy.apiUpdateUser({ language: "es" });
  cy.clearCookie("pm_lang");
}

// ---------------------------------------------------------------------------
// P-14 — sent-but-unsigned quote is AWAITING on both pages
// ---------------------------------------------------------------------------
describe("P-14 a sent-but-unsigned $850 quote reads as awaiting on both pages", () => {
  const PHONE = "+15125552720";

  before(() => {
    freshSpanishUser(PHONE);
    cy.apiCreateCustomer({
      name: "Green Goblin",
      email: "green.p14e2e@blackhole.postmarkapp.com",
      phoneNumber: "+15125552750",
    }).then((customerId) => {
      cy.apiCreateQuote({
        customerId,
        summary: "Reparación de cerca",
        jobName: "Reparación de cerca",
        lineItems: [{
          description: "Reparación de cerca",
          quantity: 1,
          unit: "job",
          price: 85000,
        }],
        estimatedTotal: 85000,
      }).then((quoteId) => {
        cy.apiSendQuoteEmail(quoteId);
        // Mirror the assistant first-quote flow post-merge: the terms
        // wizard writes its answers onto the QUOTE (there is no separate
        // contract entity) — but NOBODY signed it. Only a signature
        // (status "accepted") may count as won (P-14).
        cy.request("PUT", `/api/quotes/${quoteId}`, {
          terms: [
            {
              stepId: "payment_terms",
              label: "Payment terms",
              value: "50 / 50",
            },
          ],
        });
      });
    });
  });

  beforeEach(() => relogin(PHONE));

  it("P-14 /quotes shows it under En espera with $850 — zero ganadas, nothing decided", () => {
    cy.visit("/quotes");
    // Anchor on the loaded Spanish KPI strip first (islands SSR EN then flip).
    cy.contains(".qkpi__cell", "En espera de respuesta", { timeout: 10000 })
      .should("contain", "$850") // today: "$0"
      .and("contain", "1 cotización en espera"); // today: "0 cotizaciones en espera"
    // Not reported as won: today the KPI reads "1 ganadas · 0 perdidas".
    cy.contains("1 ganadas").should("not.exist");
    cy.contains("0 ganadas · 0 perdidas").should("exist");
    // The quote card sits in the awaiting track, not under Decididas.
    cy.contains(".qtrack", "Esperando respuesta").should("contain", "$850");
    cy.contains(".qtrack", "Decididas este mes")
      .should("contain", "0 cotizaciones") // today: "1 cotización"
      .and("not.contain", "Reparación de cerca");
  });

  it("P-14 /dashboard counts 0 trabajos activos until a customer signs", () => {
    cy.visit("/dashboard");
    cy.contains(".kpi", "Trabajos activos", { timeout: 10000 }).within(() => {
      cy.get(".kpi__val").should("have.text", "0"); // today: "1"
    });
    // The jobs panel keeps its own promise: jobs appear only once signed.
    cy.contains("Aún no hay trabajos en curso").should("exist");
  });
});

// ---------------------------------------------------------------------------
// P-15 — the onboarding sample stays out of stats and renders localized
// ---------------------------------------------------------------------------
describe("P-15 the onboarding sample pollutes nothing and leaks nothing", () => {
  const PHONE = "+15125552721";
  let sampleId: string;

  before(() => {
    freshSpanishUser(PHONE);
    cy.request("POST", "/api/agents/conversations/sample-quote")
      .its("body")
      .then((b: { quoteId: string }) => {
        sampleId = b.quoteId;
        expect(sampleId, "sample quote id").to.be.a("string");
      });
  });

  beforeEach(() => relogin(PHONE));

  it("P-15 the /quotes hero money excludes the sample's $3,700", () => {
    cy.visit("/quotes");
    // Anchor: the Spanish KPI strip has rendered.
    cy.contains(".qkpi__lbl", "En borrador", { timeout: 10000 }).should(
      "exist",
    );
    // Today the hero claims "$3,700 en trabajo en manos de los clientes"
    // out of nothing but the sample.
    cy.contains("$3,700").should("not.exist");
    // …and "1 cotización abierta en 0 clientes".
    cy.contains("0 clientes").should("not.exist");
  });

  it("P-15 no English sample copy leaks into the Spanish UI", () => {
    cy.visit("/quotes");
    cy.contains(".qkpi__lbl", "En borrador", { timeout: 10000 }).should(
      "exist",
    );
    // Today the sample card renders hardcoded-EN strings in the ES UI.
    cy.contains("Drafting").should("not.exist"); // ES: "Redactando"
    cy.contains("Not sent yet").should("not.exist"); // ES: "Aún sin enviar"
    // The sample itself was created in English regardless of the user's
    // language ("Paver Patio Installation" instead of the localized copy).
    cy.contains("Paver Patio Installation").should("not.exist");
  });

  it("P-15 the internal slug onboarding-sample is never rendered", () => {
    cy.visit("/quotes");
    cy.contains(".qkpi__lbl", "En borrador", { timeout: 10000 }).should(
      "exist",
    );
    cy.contains("onboarding-sample").should("not.exist");
    cy.visit("/dashboard");
    cy.contains(".kpi", "Trabajos activos", { timeout: 10000 }).should("exist");
    // Today the dashboard "quotes awaiting" row prints the raw summary:
    // "onboarding-sample-v1 · Paver Patio Installation".
    cy.contains("onboarding-sample").should("not.exist");
  });

  it("P-15 open-tracking is never fabricated for the sample", () => {
    // One REAL anonymous open (a cookie-less public view) at the current
    // time — nowhere near the canned "9:42am".
    cy.clearCookies();
    cy.request(`/api/quotes/${sampleId}/public`);
    relogin(PHONE);
    cy.visit("/quotes");
    cy.contains(".qkpi__lbl", "En borrador", { timeout: 10000 }).should(
      "exist",
    );
    // Today the card's engagement timeline invents "Today · 9:42am · iPhone"
    // (and "2:18pm · Mac") from a hardcoded seed list instead of showing the
    // real open — or nothing at all for a sample.
    cy.contains("9:42am").should("not.exist");
    cy.contains("2:18pm").should("not.exist");
  });
});

// ---------------------------------------------------------------------------
// P-37 — the empty-state hero only when the user truly has zero quotes
// ---------------------------------------------------------------------------
describe("P-37 no empty-pipeline hero above real (resolved) quotes", () => {
  const PHONE = "+15125552722";

  before(() => {
    freshSpanishUser(PHONE);
    cy.apiCreateCustomer({
      name: "Marta Vega",
      email: "marta.p37@blackhole.postmarkapp.com",
      phoneNumber: "+15125552751",
    }).then((customerId) => {
      cy.apiCreateQuote({
        customerId,
        summary: "Terraza nueva",
        jobName: "Terraza nueva",
        lineItems: [{
          description: "Terraza nueva",
          quantity: 1,
          unit: "job",
          price: 90000,
        }],
        estimatedTotal: 90000,
      }).then((quoteId) => {
        cy.apiSendQuoteEmail(quoteId);
        cy.apiAcceptQuote(quoteId, {
          signature: "Marta Vega",
          name: "Marta Vega",
        });
      });
    });
  });

  beforeEach(() => relogin(PHONE));

  it("P-37 a user with exactly one RESOLVED quote never sees the giant empty-state hero", () => {
    cy.visit("/quotes");
    // The real resolved card is on the page (Decididas opens by default
    // when it has rows).
    cy.contains(".qdone__title", "Terraza nueva", { timeout: 10000 }).should(
      "exist",
    );
    // Today the hero still shouts "Todavía no hay nada en el pipeline. Crea
    // tu primera cotización…" right above it, because it only counts OPEN
    // quotes. Desired: the empty-state hero renders only when the user has
    // zero quotes, open or resolved.
    cy.contains("Todavía no hay nada en el pipeline").should("not.exist");
  });
});

// ---------------------------------------------------------------------------
// P-36 — money formatting truth on the dashboard
// ---------------------------------------------------------------------------
describe("P-36 sub-$1k money renders in full and Ver todo goes somewhere", () => {
  const PHONE = "+15125552723";

  before(() => {
    freshSpanishUser(PHONE);
    cy.apiCreateCustomer({
      name: "Luis Romero",
      email: "luis.p36a@blackhole.postmarkapp.com",
      phoneNumber: "+15125552752",
    }).then((customerId) => {
      cy.apiCreateQuote({
        customerId,
        summary: "Pintura de reja",
        jobName: "Pintura de reja",
        lineItems: [{
          description: "Pintura de reja",
          quantity: 1,
          unit: "job",
          price: 85000,
        }],
        estimatedTotal: 85000,
      }).then((quoteId) => {
        cy.apiSendQuoteEmail(quoteId);
      });
    });
  });

  beforeEach(() => relogin(PHONE));

  it("P-36 an $850 pending pipeline never renders as $0.8k", () => {
    cy.visit("/dashboard");
    // Today the "Cotizaciones pendientes" KPI sub reads "$0.8k en proceso".
    cy.contains(".kpi", "Cotizaciones pendientes", { timeout: 10000 })
      .should("contain", "$850");
    cy.get("body").invoke("text").should("not.match", /\$\d\.\dk/);
  });

  it("P-36 every 'Ver todo' link goes somewhere real (href ≠ '#')", () => {
    cy.visit("/dashboard");
    cy.contains(".kpi", "Trabajos activos", { timeout: 10000 }).should("exist");
    cy.get('a:contains("Ver todo")')
      .should("have.length.at.least", 1)
      .each(($a) => {
        // Today the Active-jobs panel's "Ver todo →" is a dead href="#".
        expect($a.attr("href"), `"${$a.text().trim()}" href`).to.not.eq("#");
      });
  });
});

describe("P-36 a due-less active job renders one clean phrase and correct plural", () => {
  const PHONE = "+15125552724";

  before(() => {
    freshSpanishUser(PHONE);
    cy.apiCreateCustomer({
      name: "Sofia Peralta",
      email: "sofia.p36b@blackhole.postmarkapp.com",
      phoneNumber: "+15125552753",
    }).then((customerId) => {
      cy.apiCreateQuote({
        customerId,
        summary: "Reparar cerca",
        jobName: "Reparar cerca",
        lineItems: [{
          description: "Reparar cerca",
          quantity: 1,
          unit: "job",
          price: 90000,
        }],
        estimatedTotal: 90000,
      }).then((quoteId) => {
        cy.apiSendQuoteEmail(quoteId);
        // A SIGNED agreement, but no invoice yet → a legit active job with
        // no due date. NOTE: POST /quotes/:id/accept now always bills (it
        // creates the milestone invoices), so the due-less state is seeded
        // via the owner update instead — the accepted quote IS the signed
        // agreement (isAccepted: status "accepted" + acceptedAt).
        cy.request("PUT", `/api/quotes/${quoteId}`, {
          status: "accepted",
          acceptedAt: new Date().toISOString(),
          acceptedName: "Sofia Peralta",
        });
      });
    });
  });

  beforeEach(() => relogin(PHONE));

  it("P-36 the job row never reads 'Vence Sin fecha de vencimiento'", () => {
    cy.visit("/dashboard");
    // The one real job renders in the panel…
    cy.contains(".panel", "Trabajos activos", { timeout: 10000 })
      .should("contain", "Sofia Peralta");
    // …but a missing due date must be ONE clean phrase, not the run-on the
    // audit found ("Reparar cerca… Vence Sin fecha de vencimiento";
    // EN: "Due No due date").
    cy.contains("Vence Sin fecha de vencimiento").should("not.exist");
  });

  it("P-36 exactly one job pluralizes as '1 activo', never '1 activos'", () => {
    cy.visit("/dashboard");
    cy.contains(".panel", "Trabajos activos", { timeout: 10000 })
      .should("contain", "Sofia Peralta");
    cy.contains("1 activos").should("not.exist");
  });
});
