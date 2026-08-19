/// <reference types="cypress" />

/**
 * Post-accept confirmation parity — live-UI RED spec for ux-problems.md:
 *
 *   UX-22 "[POST-ACCEPT] The immediate accept confirmation (customer side) is
 *         thinner than the reload. Right after accepting, the card shows only
 *         '✓ Cotización aceptada'; on reload it shows 'Aceptada por María
 *         Nguyen el 18 de agosto de 2026' + ACEPTADA badge. Render the full
 *         evidence immediately."
 *
 * Phones used (block +15125556100-6199):
 *   +15125556130 contractor   +15125556163 its customer (María, phone-only)
 *
 * Grounded selectors / source:
 *   Accept form + immediate success card — front-end/islands/PublicAcceptQuote.tsx:
 *     name input   input[autocomplete=name] (:112-121, placeholder
 *                  publicAcceptQuote.namePlaceholder "Juan Pérez")
 *     submit       button[type=submit] "Aceptar esta cotización →" (:138-149)
 *     success card (:86-101) renders ONLY publicAcceptQuote.success.title
 *                  ("Cotización aceptada") + a contractor-contact sub — no
 *                  acceptor name, no date, no badge. This is the UX-22 gap.
 *   Reload (SSR) accepted state — front-end/routes/q/[id].tsx:
 *     ACEPTADA badge  header <span> tFor("status.accepted") = "Aceptada",
 *                     CSS-uppercased (:202-207)
 *     evidence card   "✓ Cotización aceptada" + publicQuote.acceptedByOn
 *                     "Aceptada por {name} el {date}." (:327-344), date via
 *                     toLocaleDateString("es-MX", long) (:391-399)
 *   The accept island posts /api/quotes/:id/accept and flips ONLY its local
 *   card (PublicAcceptQuote.tsx:52-101); PublicQuoteActions.tsx:74-94 merely
 *   remounts the same success card — neither surfaces the badge/name/date the
 *   SSR page already knows how to render.
 *
 * Language: /q resolves UI chrome from the pm_lang cookie first
 * (routes/q/[id].tsx:62-64), so the spec pins ES deterministically via
 * cy.setCookie("pm_lang","es") before visiting.
 */

const MARIA = "María Nguyen";

/** The exact long-form ES date the SSR accepted card renders
 *  (routes/q/[id].tsx:391-399 — es-MX, numeric year, long month). Computed at
 *  assert time; a run crossing midnight could flake by a day (acceptable). */
function acceptedDateEs(): string {
  return new Date().toLocaleDateString("es-MX", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

describe("UX-22 accepting on /q shows the full evidence immediately, not only after reload", () => {
  const PHONE = "+15125556130";
  let quoteId: string;

  before(() => {
    cy.clearCookies();
    cy.loginAs(PHONE);
    cy.request("/api/me/wipe");
    cy.loginAs(PHONE);
    cy.request("POST", "/api/me/onboarded", { skipped: true });
    cy.apiUpdateUser({ name: "Rafa Morales", language: "es" });
    // Keep the DOC language Spanish too (routes/q/[id].tsx:61 reads
    // contractor.commsLanguage for content).
    cy.apiUpdateProfile({ businessName: "Techos Morales", commsLanguage: "es" });
    cy.apiCreateCustomer({ name: MARIA, phoneNumber: "+15125556163" }).then(
      (customerId: string) => {
        cy.apiCreateQuote({
          customerId,
          summary: "Instalación de patio de adoquines",
          jobName: "Patio de adoquines",
          lineItems: [
            {
              description: "Patio de adoquines 20x15",
              quantity: 1,
              unit: "ea",
              price: 370000,
            },
          ],
          estimatedTotal: 370000, // $3,700 in integer cents
        }).then((id: string) => {
          quoteId = id;
        });
      },
    );
  });

  it("UX-22 the immediate confirmation carries badge + 'Aceptada por <name>' + date; reload agrees", () => {
    // The customer opens the public link (anonymous, Spanish chrome).
    cy.clearCookies();
    cy.setCookie("pm_lang", "es");
    cy.viewport(390, 844); // the audited mobile customer context
    cy.visit(`/q/${quoteId}`);

    // Drive the REAL accept UI (PublicAcceptQuote.tsx:108-150).
    cy.get("input[autocomplete=name]", { timeout: 10000 })
      .should("be.visible")
      .type(MARIA);
    cy.contains("button[type=submit]", "Aceptar esta cotización")
      .should("not.be.disabled")
      .click();

    // Immediate success is acknowledged today (green guard —
    // publicAcceptQuote.success.title).
    cy.contains("Cotización aceptada", { timeout: 10000 }).should("be.visible");

    // ---- The UX-22 reds: WITHOUT reloading, the page must already show the
    // full evidence the reload shows. Today the card renders only the thin
    // "✓ Cotización aceptada" + "Rafa se pondrá en contacto…" line.
    // 1) Who accepted (publicQuote.acceptedByOn with the typed name):
    cy.contains(`Aceptada por ${MARIA}`).should("be.visible");
    // 2) When (the same long es-MX date the SSR card renders):
    cy.contains(acceptedDateEs()).should("be.visible");
    // 3) The ACEPTADA status badge (routes/q/[id].tsx:202-207 — a standalone
    //    <span> whose exact text is "Aceptada", uppercased by CSS; no other
    //    element on the page carries that exact text).
    cy.contains("span", /^\s*Aceptada\s*$/).should("be.visible");

    // ---- Parity: reload and assert the SAME evidence (green today — the
    // persisted P-11 state; pinned so "fixing" the immediate card can never
    // regress the reload, and both renders stay identical).
    cy.reload();
    cy.contains("Cotización aceptada", { timeout: 10000 }).should("be.visible");
    cy.contains(`Aceptada por ${MARIA}`).should("be.visible");
    cy.contains(acceptedDateEs()).should("be.visible");
    cy.contains("span", /^\s*Aceptada\s*$/).should("be.visible");
  });
});

// Module scope — keeps helper names out of the shared global spec scope.
export {};
