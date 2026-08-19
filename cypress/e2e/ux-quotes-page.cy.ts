/// <reference types="cypress" />

/**
 * UX audit (ux-problems.md) — /quotes page reds.
 *
 * UX-08 [QUOTES] "The accepted quote is a dead end on /quotes mobile. Tapping
 *   the 'Decididas este mes' row does nothing (inert row; only a dismiss ×) …
 *   the ?open=<id> deep-link renders the panel below the hero + 4 KPI cards
 *   without scrolling it into view. The decided row also shows '—' where the
 *   customer name belongs."
 * UX-16 [I18N] "/quotes browser-tab title is English ('Quotes · Paperwork
 *   Monster') in the ES UI."
 * UX-17 [QUOTES] "Sample-quote presentation confuses the numbers story. KPI
 *   says '0 cotizaciones en espera' while the track header says '… · 1
 *   cotización' (the visible-but-excluded MUESTRA card); the sample card
 *   renders several placeholder dashes ('—') and an empty avatar tile."
 * UX-18 [COPY] "Truncation without ellipsis" — summary cut mid-phrase on the
 *   open panel.
 *
 * Grounded selectors (all read from source):
 *   decided row            .qdone__row / .qdone__title / .qdone__client
 *                          (front-end/components/QuotesSections.tsx:193-214 —
 *                          a plain <div>, no click handler: the inert row)
 *   open panel             [data-cy=quote-open-panel] (.qopen)
 *                          (front-end/islands/QuotesPage.tsx:160; rendered
 *                          BELOW QuotesHero + QuotesKpis at :371-397 with no
 *                          scroll-into-view logic — the deep-link bug)
 *   KPI accent cell        .qkpi__cell--accent .qkpi__sub → quotesKpi.outWaiting
 *                          "N cotización(es) en espera" — REAL quotes only
 *                          (front-end/islands/QuotesPage.tsx:349-350 out=isReal)
 *   track 01 header count  .qtrack__count → quoteTrack.count "N cotización(es)"
 *                          — samples INCLUDED (QuotesPage.tsx:337-339 outCards,
 *                          :404 count={outCards.length}; QuoteTrack.tsx:73-79)
 *   sample card            .qcard containing quoteCard.sampleTag "Muestra";
 *                          bare dashes: .qcard__av ("—" from initialsFromName,
 *                          QuotesPage.tsx:45-51) and .qcard__client-name ("—"
 *                          from clientFromSummary fallback, QuotesPage.tsx:53-57)
 *   open-panel summary     .qopen__summary (QuotesPage.tsx:173-175)
 *
 * Deterministic UX-18 driver (probed live with curl, 2026-08-19):
 *   POST /api/agents/job-details/polish {"raw": <15 ES words>} →
 *   {"summary":"Instalación de patio de adoquines 20x15 para la", …} — the
 *   silent 8-word cut (backend/src/agents/domain/coordinators/
 *   polish-job-details/mod.ts:126-130,152). The test stores that summary on a
 *   quote exactly like the assistant does, then asserts the panel never shows
 *   a silent cut.
 *
 * Sample-quote seeding: POST /api/agents/conversations/sample-quote
 *   (backend/src/agents/entrypoints/conversations-controller/mod.ts:151-158,
 *   idempotent; sample is customer-less, status "sent" → lands in track 01).
 *
 * Phones (slice F block): contractor +15125556500, customer +15125556501.
 */

const PHONE = "+15125556500";
const CUSTOMER_PHONE = "+15125556501";
const CUSTOMER_NAME = "María Nguyen";

const LONG_RAW =
  "Instalación de patio de adoquines 20x15 para la familia Nguyen con base de grava compactada";

function loginEsFresh() {
  // Clean slate per exemplar (clients-page-quality.cy.ts): wipe → re-login →
  // skip onboarding → Spanish UI, letting the user's language win.
  cy.clearCookies();
  cy.loginAs(PHONE);
  cy.request({ url: "/api/me/wipe", failOnStatusCode: false });
  cy.loginAs(PHONE);
  cy.request("POST", "/api/me/onboarded", { skipped: true });
  cy.apiUpdateUser({ language: "es" });
  cy.clearCookie("pm_lang");
}

/** Seed an ACCEPTED (decided/won) quote for a linked customer and yield its id. */
function seedAcceptedQuote(): Cypress.Chainable<string> {
  return cy
    .apiCreateCustomer({
      name: CUSTOMER_NAME,
      email: "maria.ux08@blackhole.postmarkapp.com",
      phoneNumber: CUSTOMER_PHONE,
    })
    .then((customerId: string) =>
      cy.apiCreateQuote({
        customerId,
        summary: "Instalación de patio de adoquines",
        jobName: "Patio de adoquines",
        lineItems: [
          { description: "Patio", quantity: 1, unit: "ea", price: 370_000 },
        ],
        estimatedTotal: 370_000,
      })
    )
    .then((quoteId: string) => {
      // Customer-side accept (anonymous, like the /q page) → stage "won".
      cy.clearCookies();
      cy.apiAcceptQuote(quoteId, {
        signature: CUSTOMER_NAME,
        name: CUSTOMER_NAME,
      });
      cy.loginAs(PHONE);
      cy.apiUpdateUser({ language: "es" });
      cy.clearCookie("pm_lang");
      return cy.wrap(quoteId);
    });
}

describe("UX-08: decided quotes are reachable from the /quotes list (390×844)", () => {
  beforeEach(() => {
    loginEsFresh();
    cy.viewport(390, 844);
  });

  it("UX-08: tapping the decided row opens the detail panel showing the customer name", () => {
    seedAcceptedQuote().then(() => {
      cy.visit("/quotes");
      // Track 03 defaults open when it has rows (QuotesPage.tsx:455).
      cy.get(".qdone__row", { timeout: 10_000 }).should("be.visible");
      // Tap the row body (its title — NOT the delete icon).
      cy.get(".qdone__row .qdone__title").first().click();
      // RED today: .qdone__row has no click handler (QuotesSections.tsx:199)
      // so no panel ever appears. Desired: the tap opens the quote's detail
      // panel and that panel shows WHO the customer is (no bare "—").
      cy.get("[data-cy=quote-open-panel]", { timeout: 10_000 })
        .should("be.visible")
        .and("contain.text", CUSTOMER_NAME);
    });
  });

  it("UX-08: the ?open=<id> deep-link scrolls the panel into the viewport", () => {
    seedAcceptedQuote().then((quoteId) => {
      cy.visit(`/quotes?open=${quoteId}`);
      // Wait for the panel to finish loading (title rendered, not the
      // "loading" pending state).
      cy.get("[data-cy=quote-open-panel]", { timeout: 10_000 })
        .should("contain.text", "Patio de adoquines");
      // RED today: the panel renders below the hero + 4 stacked KPI cells at
      // 390px and nothing scrolls it into view (QuotesPage.tsx:397 — plain
      // conditional render, no scrollIntoView). Desired: on load its bounding
      // rect intersects the 390×844 viewport. (.should retries, so a fix that
      // scrolls asynchronously after data load still passes.)
      cy.get("[data-cy=quote-open-panel]").should(($el) => {
        const rect = $el[0].getBoundingClientRect();
        const vh = Cypress.config("viewportHeight");
        expect(
          rect.top < vh && rect.bottom > 0,
          `panel rect (top ${Math.round(rect.top)}, bottom ${
            Math.round(rect.bottom)
          }) intersects the ${vh}px viewport`,
        ).to.eq(true);
      });
    });
  });
});

describe("UX-16: ES /quotes browser-tab title is localized", () => {
  it("UX-16: cy.title() contains 'Cotizaciones' for a Spanish user", () => {
    loginEsFresh();
    cy.visit("/quotes");
    // Fix-independent ES marker so the assertion never races the ES flip.
    cy.contains(/cotizaci/i, { timeout: 10_000 }).should("be.visible");
    // RED today: front-end/routes/quotes/index.tsx:19 hardcodes
    // "Quotes · Paperwork Monster" (dashboard/invoices use tFor docTitle).
    cy.title().should("contain", "Cotizaciones");
  });
});

describe("UX-17: the sample quote tells ONE truthful numbers story", () => {
  beforeEach(() => {
    loginEsFresh();
    // Idempotent onboarding sample (isSample, status "sent", no customer).
    cy.request("POST", "/api/agents/conversations/sample-quote");
    cy.visit("/quotes");
    cy.contains(".qcard", /muestra/i, { timeout: 10_000 }).should("be.visible");
  });

  it("UX-17: the 'En espera' KPI count and the track-01 header count AGREE", () => {
    // RED today with only the sample present: the KPI sub counts REAL quotes
    // (0 — QuotesPage.tsx:349-350,391) while the track header counts every
    // rendered card incl. the sample (1 — QuotesPage.tsx:337,404). Whatever
    // definition the fix picks (count it annotated, or separate it), the two
    // numbers shown for the same track must be equal.
    cy.get(".qkpi__cell--accent .qkpi__sub").invoke("text").then((kpiText) => {
      cy.get(".qtrack").first().find(".qtrack__count").invoke("text").then(
        (trackText) => {
          const kpiN = parseInt(String(kpiText).match(/\d+/)?.[0] ?? "-1", 10);
          const trackN = parseInt(
            String(trackText).match(/\d+/)?.[0] ?? "-2",
            10,
          );
          expect(
            kpiN,
            `KPI count ("${String(kpiText).trim()}") equals track-01 header count ("${
              String(trackText).trim()
            }")`,
          ).to.eq(trackN);
        },
      );
    });
  });

  it("UX-17: the sample card shows no bare placeholder dashes", () => {
    // RED today: with no bound customer, the card renders "—" in the avatar
    // tile (initialsFromName → "—", QuotesPage.tsx:45-51) and "—" as the
    // client name (clientFromSummary fallback, QuotesPage.tsx:53-57).
    cy.contains(".qcard", /muestra/i).within(() => {
      cy.get(".qcard__av").invoke("text").then((t) => {
        expect(String(t).trim(), "sample avatar tile is not a bare dash").not
          .to.eq("—");
      });
      cy.get(".qcard__client-name").invoke("text").then((t) => {
        expect(String(t).trim(), "sample client line is not a bare dash").not
          .to.eq("—");
      });
    });
  });
});

describe("UX-18: the open-panel summary is never a silent mid-phrase cut", () => {
  it("UX-18: the visible summary either fits whole or ends with '…'", () => {
    loginEsFresh();
    // Drive the REAL truncation path the assistant uses when it seeds
    // quote.summary (probed live: returns the silent 8-word cut
    // "Instalación de patio de adoquines 20x15 para la").
    cy.request("POST", "/api/agents/job-details/polish", { raw: LONG_RAW })
      .then((res) => {
        const polished = res.body as {
          summary: string;
          jobName: string;
          description: string;
        };
        return cy
          .apiCreateCustomer({
            name: CUSTOMER_NAME,
            email: "maria.ux18@blackhole.postmarkapp.com",
            phoneNumber: CUSTOMER_PHONE,
          })
          .then((customerId: string) =>
            cy.apiCreateQuote({
              customerId,
              summary: polished.summary,
              jobName: polished.jobName,
              description: polished.description,
              lineItems: [
                { description: "Patio", quantity: 1, unit: "ea", price: 370_000 },
              ],
              estimatedTotal: 370_000,
            })
          );
      })
      .then((quoteId: string) => {
        cy.visit(`/quotes?open=${quoteId}`);
        cy.get("[data-cy=quote-open-panel] .qopen__summary", {
          timeout: 10_000,
        })
          .invoke("text")
          .then((raw) => {
            const text = String(raw).trim();
            const fitsWhole = LONG_RAW.startsWith(text) &&
              text.length >= LONG_RAW.length;
            const hasEllipsis = text.endsWith("…");
            // RED today: the panel shows the stored 8-word cut ending at
            // "para la" — neither the whole phrase nor an ellipsis.
            expect(
              fitsWhole || hasEllipsis,
              `summary ("${text}") fits whole or ends with '…'`,
            ).to.eq(true);
          });
      });
  });
});

// Module scope: keeps top-level declarations out of the shared global
// script scope the spec files otherwise compile into.
export {};
