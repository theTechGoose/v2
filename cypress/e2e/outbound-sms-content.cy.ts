/// <reference types="cypress" />

/**
 * RED (TDD) — outbound SMS content, UI path (small spec; the deep matrix
 * lives in jest/integration/sms-content.int.test.ts).
 *
 * Problems covered (problems.md, verbatim fragments):
 *  P-27: "SMS sends the wrong-language job name. send-paperwork-sms/mod.ts:305,331
 *         use raw q.jobName while the email path correctly projects jobNameByLang[lang]"
 *  P-30: "'Hola hola,' SMS to unnamed customers. ES signedConfirm.sms.nameFallback =
 *         'hola' fills 'Hola {first}…' → 'Hola hola, tu Cotización + Acuerdo…'"
 *
 * Scenario: ES contractor (language + commsLanguage "es"), UNNAMED customer,
 * quote whose raw jobName ("Kitchen Remodel") differs from jobNameByLang.es
 * ("Remodelación de cocina"). Observable: /api/messages (Twilio silent in dev;
 * every outbound text is recorded in the comms log with channel "text").
 *
 * UI-affordance note (P-27): there is NO plain quote-text button in today's UI —
 * the QuoteCard back-face "Resend" button (front-end/islands/QuoteCard.tsx:186)
 * is a stopPropagation no-op and the only real dispatch path is the assistant
 * wizard's send-quote CTA. So the quote-text test fires the same
 * POST /api/quotes/:id/text the UI issues and asserts through the comms log,
 * while the signed-confirm test (P-30) drives the REAL public signing UI on
 * /q (accepting the quote IS the signature ceremony).
 */
describe("outbound SMS content (ES) — P-27 localized job name, P-30 no 'Hola hola'", () => {
  const PHONE = "+15125552350"; // reserved block +15125552300…99
  const CUSTOMER_PHONE = "+15125552351";
  const JOB_EN = "Kitchen Remodel";
  const JOB_ES = "Remodelación de cocina";
  /** Sentence-initial capital: uppercase letter (incl. Spanish accents/Ñ) or ¡. */
  const STARTS_CAPITAL = /^(¡|[A-ZÁÉÍÓÚÜÑ])/u;

  let quoteId: string;

  before(() => {
    cy.clearCookies();
    cy.loginAs(PHONE);
    cy.request("POST", "/api/me/onboarded", { skipped: true }); // skip the /welcome trap for fresh users
    cy.apiUpdateUser({ language: "es", name: "Marta Contratista" });
    cy.apiUpdateProfile({ businessName: "MARTA LLC", commsLanguage: "es" });
    cy.seedQuoteToCash({
      customer: {
        name: "", // UNNAMED customer — drives the greeting fallback
        phoneNumber: CUSTOMER_PHONE,
        email: "sms.es.cy@blackhole.postmarkapp.com",
      },
      quote: {
        jobName: JOB_EN, // raw jobName deliberately the EN string
        summary: "Remodel the kitchen",
        jobNameByLang: { en: JOB_EN, es: JOB_ES },
      },
    }).then((ids) => {
      quoteId = ids.quoteId;
    });
  });

  it("P-27: the quote text logged in the comms trail carries the ES job name, not the raw EN one", () => {
    cy.loginAs(PHONE);
    cy.request("POST", `/api/quotes/${quoteId}/text`)
      .its("status")
      .should("be.lessThan", 400);
    cy.request("/api/messages").then(({ body }) => {
      const texts = (body as Array<Record<string, unknown>>).filter(
        (m) => m.channel === "text" && m.paperworkId === quoteId,
      );
      expect(texts.length, "quote text recorded in /api/messages").to.be
        .greaterThan(0);
      const content = String(texts[texts.length - 1].content ?? "");
      // Desired: the SMS projects jobNameByLang[es] exactly like the email path.
      expect(content, "SMS body uses the contractor-language job name").to
        .contain(JOB_ES);
      expect(content, "raw EN job name must not leak into the ES SMS").not.to
        .contain(JOB_EN);
    });
  });

  it("P-30: signing through the public UI sends the unnamed customer a confirm text that never reads 'Hola hola'", () => {
    // Customer context: anonymous public agreement page (test isolation
    // already cleared cookies). EN page copy pinned like
    // public-quote-signature.cy.ts.
    cy.setCookie("pm_lang", "en");
    cy.visit(`/q/${quoteId}`);
    cy.get("form.ctr__sign-form", { timeout: 10_000 })
      .find("input")
      .first()
      .type("Cliente Firmante");
    cy.contains("button", /^sign|firmar/i).click();
    cy.contains(/signed|firmado|thank/i, { timeout: 10_000 }).should(
      "be.visible",
    );

    // Contractor context: the signed-confirm SMS must land in the comms trail
    // (roadmap p.8 — every outbound text queryable per document). The dispatch
    // is fire-and-forget server-side (PDF + first invoice render first), so poll.
    cy.loginAs(PHONE);
    const findSignedText = (
      attempt: number,
    ): Cypress.Chainable<Record<string, unknown> | undefined> =>
      cy.request("/api/messages").then(({ body }) => {
        const hit = (body as Array<Record<string, unknown>>).find(
          // The signed-confirm text ("…está firmada — ¡todo listo!…") — not
          // the P-27 quote-send text, which also carries the /q link.
          (m) =>
            m.channel === "text" && JSON.stringify(m).includes(quoteId) &&
            /firmad|signed/i.test(String(m.content ?? "")),
        );
        if (!hit && attempt < 20) {
          return cy.wait(500, { log: false }).then(() =>
            findSignedText(attempt + 1)
          );
        }
        return cy.wrap(hit, { log: false });
      });
    findSignedText(0).then((entry) => {
      expect(entry, "signed-confirm text recorded in /api/messages").to.exist;
      const content = String(entry?.content ?? "");
      expect(content, "no doubled greeting for unnamed customers").not.to.match(
        /hola[\s,]+hola/i,
      );
      expect(content, "greeting starts with a capital").to.match(
        STARTS_CAPITAL,
      );
    });
  });
});
