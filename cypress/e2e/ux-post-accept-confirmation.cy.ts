/// <reference types="cypress" />

/**
 * Post-accept confirmation parity (UX-22, ported to the merged product):
 *
 * The quote IS the agreement — accepting on /q via the PublicSignQuote pad
 * is the one signature ceremony. Right after signing, the customer must see
 * the full evidence, not a thin acknowledgment: the island shows its
 * success card ("Firmado y vinculante") and reloads ~900ms later so the
 * persisted signed state renders — the FIRMADO badge with the date, the
 * customer-signature card filled with her mark, and the signed strip. A
 * manual reload must agree with what the ceremony left on screen (P-11).
 *
 * Phones used (block +15125556100-6199):
 *   +15125556130 contractor   +15125556163 its customer (María, phone-only)
 *
 * Grounded selectors / source (read post-merge):
 *   Sign pad — front-end/islands/PublicSignQuote.tsx:
 *     form         form.ctr__sign-form (name input inside it,
 *                  placeholder publicSign.namePlaceholder "Juan Pérez")
 *     submit       button[type=submit] "Firmar el acuerdo →"
 *                  (publicSign.submitEnabled)
 *     success card publicSign.success.title "Firmado y vinculante"; the
 *                  island then reloads (~900ms) so the SSR'd island fetch
 *                  renders the persisted accepted state.
 *   Signed state — front-end/components/quote-doc.tsx:
 *     badge pill   quoteDoc.signed "Firmado {date}" (lang-aware fmtDate)
 *     evidence     quoteDoc.signatureOf "Firma de {name}" + the stored
 *                  signature image (img[alt=<acceptedName>], P-40)
 *     strip        quoteDoc.signedBinding "Firmado y vinculante" +
 *                  quoteDoc.bothCaptured "Ambas firmas capturadas."
 *
 * Language: /q resolves the document language from the pm_lang cookie first
 * (routes/q/[id].tsx), so the spec pins ES deterministically via
 * cy.setCookie("pm_lang","es") before visiting.
 */

const MARIA = "María Nguyen";

// The signed ES date rendered by the shared formatter (formatLongDate —
// UTC-based "20 de agosto de 2026"). Regex rather than a computed string so
// a run crossing midnight can't flake by a day.
const FIRMADO_ES = new RegExp(
  String.raw`Firmado\s+\d{1,2} de \p{L}+ de \d{4}`,
  "iu",
);

describe("UX-22 signing on /q shows the full evidence right away, and reload agrees", () => {
  const PHONE = "+15125556130";
  let quoteId: string;

  before(() => {
    cy.clearCookies();
    cy.loginAs(PHONE);
    cy.request("/api/me/wipe");
    cy.loginAs(PHONE);
    cy.request("POST", "/api/me/onboarded", { skipped: true });
    cy.apiUpdateUser({ name: "Rafa Morales", language: "es" });
    // Keep the DOC language Spanish too (QuoteDoc falls back to
    // contractor.commsLanguage for content).
    cy.apiUpdateProfile({
      businessName: "Techos Morales",
      commsLanguage: "es",
    });
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

  it("UX-22 the ceremony ends on the full evidence — badge, 'Firma de <name>', signature mark; reload agrees", () => {
    // The customer opens the public link (anonymous, Spanish chrome).
    cy.clearCookies();
    cy.setCookie("pm_lang", "es");
    cy.viewport(390, 844); // the audited mobile customer context
    cy.visit(`/q/${quoteId}`);

    // Drive the REAL signature ceremony (PublicSignQuote): type the legal
    // name (the pad drawing is optional) and submit.
    cy.get("form.ctr__sign-form", { timeout: 10000 })
      .find("input")
      .first()
      .should("be.visible")
      .type(MARIA);
    cy.contains("button[type=submit]", "Firmar el acuerdo")
      .should("not.be.disabled")
      .click();

    // Immediate success is acknowledged (publicSign.success.title).
    cy.contains("Firmado y vinculante", { timeout: 10000 }).should(
      "be.visible",
    );

    // ---- The full evidence, WITHOUT the customer touching anything else
    // (the island's own ~900ms reload swaps in the persisted state):
    // 1) The FIRMADO badge with the ES date (quoteDoc.signed):
    cy.contains(FIRMADO_ES, { timeout: 15000 }).should("be.visible");
    // 2) Who signed — the customer card heading (quoteDoc.signatureOf):
    cy.contains(`Firma de ${MARIA}`).should("be.visible");
    // 3) Her captured mark (P-40 — the typed-name PNG the island rendered):
    cy.get(`img[alt="${MARIA}"]`)
      .should("have.attr", "src")
      .and("match", /^data:image\/png/);
    // 4) Both-signatures line + no leftover ceremony chrome.
    cy.contains("Ambas firmas capturadas.").should("be.visible");
    cy.get("form.ctr__sign-form").should("not.exist");

    // ---- Parity: a manual reload shows the SAME evidence (the persisted
    // P-11 state; pinned so the post-ceremony render and the reload can
    // never drift apart).
    cy.reload();
    cy.contains(FIRMADO_ES, { timeout: 10000 }).should("be.visible");
    cy.contains(`Firma de ${MARIA}`).should("be.visible");
    cy.get(`img[alt="${MARIA}"]`)
      .should("have.attr", "src")
      .and("match", /^data:image\/png/);
    cy.contains("Ambas firmas capturadas.").should("be.visible");
    cy.get("form.ctr__sign-form").should("not.exist");
  });
});

// Module scope — keeps helper names out of the shared global spec scope.
export {};
