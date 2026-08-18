/// <reference types="cypress" />

/**
 * RED (TDD) — UI-path re-assertion of the two highest-value outbound fixes.
 * The deep matrix lives in jest (jest/integration/email-content.int.test.ts).
 *
 * P-44 "ES email subject uses English word order — '{businessName} Cotización
 *       para {customerName}…' instead of 'Cotización de {businessName} para…'"
 * P-06 "'Nuevo usuario' / 'New user' leaks into customer-facing email and SMS"
 *
 * Observable: the communication log (GET /api/messages) — Postmark's test
 * token sends silently, so the logged subject/content IS the outbound copy.
 * Live-probed current bad strings (2026-08-18):
 *   "JEST LLC Cotización para Cliente Jest, Instalación de baño y cocina"
 *   "Invoice #23888090 — due August 20, 2026 from Nuevo usuario"
 *   "Hi Cliente, this is Nuevo.\n\nYour Quote + Agreement for …"
 *
 * UI affordances: /invoices cards expose the real send buttons
 * ([data-cy=invoice-cta-drafting] "Finish + send" → PUT status:"sent" +
 * POST /api/invoices/:id/email + /text — front-end/islands/InvoicesPage.tsx
 * doFinishDraft/dispatchInvoice). The /quotes page has NO send button (quote
 * sends run through the assistant flow, clients/assistant.ts sendQuote →
 * POST /quotes/:id/email), so the quote it dispatches via the same endpoint
 * and verifies the UI receipt strip on /quotes?open=<id> reads the same log.
 */

type LoggedMessage = {
  channel?: string;
  subject?: string;
  content?: string;
  body?: string;
  paperworkId?: string;
};

const PLACEHOLDER = /Nuevo usuario|New user/;

function messagesFor(paperworkId: string) {
  return cy.request("/api/messages").then((res) => {
    const all: LoggedMessage[] = Array.isArray(res.body) ? res.body : res.body?.items ?? [];
    return all.filter((m) => JSON.stringify(m).includes(paperworkId));
  });
}

/** Bounded poll for the dispatch attempt: resolves with the paperwork's logged
 *  messages as soon as any exist, or with [] after ~5s (a fix that REFUSES the
 *  send pending the contractor's real name legitimately logs nothing). */
function pollMessages(
  paperworkId: string,
  tries = 10,
): Cypress.Chainable<LoggedMessage[]> {
  return messagesFor(paperworkId).then((msgs) => {
    if (msgs.length > 0 || tries <= 0) return cy.wrap(msgs, { log: false });
    return cy.wait(500, { log: false }).then(() => pollMessages(paperworkId, tries - 1));
  });
}

/** SKIP-SETUP login: master OTP + onboarded(skipped) + PUT /me WITHOUT a name,
 *  so the seeded placeholder "Nuevo usuario" (verify-otp/mod.ts:35) survives.
 *  Deliberately NOT cy.loginAs — that helper seeds name "Dev User". */
function loginSkipUser(phone: string) {
  cy.clearCookies();
  cy.request("POST", "/api/auth/verify", { phoneNumber: phone, code: "000000" });
  cy.request("POST", "/api/me/onboarded", { skipped: true }); // skip the /welcome trap
  cy.request({
    method: "PUT",
    url: "/api/me",
    body: { email: "skip.cy@blackhole.postmarkapp.com", language: "es" },
    failOnStatusCode: false,
  });
  // Guard the premise: this account must still carry the placeholder name.
  cy.request("/api/me").its("body.name").should("match", PLACEHOLDER);
}

describe("P-44/P-06 outbound email content (UI path)", () => {
  it('P-44 ES quote email subject reads "Cotización de {biz} para {customer}…"', () => {
    cy.clearCookies();
    cy.loginAs("+15125552250");
    cy.request("POST", "/api/me/onboarded", { skipped: true });
    cy.apiUpdateUser({ language: "es" });
    cy.clearCookie("pm_lang");
    // Outbound language + business name (renderQuoteSubject reads the
    // business identity — send-paperwork-email/mod.ts:513-538).
    cy.apiUpdateProfile({ businessName: "Cypress ES LLC", commsLanguage: "es" });

    cy.apiCreateCustomer({
      name: "Cliente Cy",
      email: "cliente.cy@blackhole.postmarkapp.com",
      phoneNumber: "+15125552251",
    }).then((customerId) => {
      cy.apiCreateQuote({
        customerId,
        summary: "instalación de baño y cocina",
        jobName: "Instalación de baño y cocina",
        lineItems: [
          { description: "Instalación de gabinetes", quantity: 3, unit: "ea", price: 35000 },
        ],
        estimatedTotal: 105000,
      }).then((quoteId) => {
        cy.apiSendQuoteEmail(quoteId).its("status").should("be.lessThan", 400);

        // The quotes UI reads the SAME comms log for its receipt strip —
        // prove the send surfaced in the app before asserting the copy.
        cy.visit(`/quotes?open=${quoteId}`);
        cy.get("[data-cy=quote-open-panel]", { timeout: 10_000 })
          .should("contain.text", "cliente.cy@blackhole.postmarkapp.com");

        messagesFor(quoteId).then((msgs) => {
          const email = msgs.find((m) => m.channel === "email");
          expect(email, "logged quote email").to.exist;
          const subject = email!.subject ?? "";
          // Today (probed live): "Cypress ES LLC Cotización para Cliente Cy, …"
          expect(subject).not.to.match(/^Cypress ES LLC\s+Cotización/);
          expect(
            subject.startsWith("Cotización de Cypress ES LLC para Cliente Cy"),
            `es word order, got: "${subject}"`,
          ).to.eq(true);
        });
      });
    });
  });

  it('P-06 "Finish + send" on /invoices never sends placeholder-name copy', () => {
    loginSkipUser("+15125552260");
    // Unique client name so THIS run's draft card is unambiguous even if an
    // earlier failed run left a stale draft behind.
    const client = `Cliente Cy ${Date.now()}`;
    cy.apiCreateCustomer({
      name: client,
      email: "cliente.cy2@blackhole.postmarkapp.com",
      phoneNumber: "+15125552261",
    }).then((customerId) => {
      cy.apiCreateInvoice({
        customerId,
        amount: 45000,
        dueDate: "2026-08-20",
        status: "draft",
      }).then((invoiceId) => {
        cy.visit("/invoices");
        // The real UI send affordance: "Finish + send" on the draft card
        // (InvoicesPage doFinishDraft → PUT status:"sent" + email + text).
        cy.contains(".qcard", client, { timeout: 10_000 })
          .find("[data-cy=invoice-cta-drafting]")
          .click();

        // Desired: either the send was refused pending the real name (nothing
        // gets logged), or the copy fell back to the business name — the
        // placeholder never ships. Today red: the poll finds the email row
        // with subject "Invoice #… — due August 20, 2026 from Nuevo usuario".
        pollMessages(invoiceId).then((msgs) => {
          for (const m of msgs) {
            expect(JSON.stringify(m)).not.to.match(PLACEHOLDER);
          }
        });
      });
    });
  });

  it("P-06 skip-user quote dispatch (email + text) carries no placeholder copy", () => {
    loginSkipUser("+15125552260");
    cy.apiCreateCustomer({
      name: "Cliente Texto",
      email: "cliente.cy3@blackhole.postmarkapp.com",
      phoneNumber: "+15125552262",
    }).then((customerId) => {
      cy.apiCreateQuote({
        customerId,
        summary: "pintura de interiores",
        jobName: "Pintura de interiores",
        lineItems: [{ description: "Pintura", quantity: 1, unit: "ea", price: 50000 }],
        estimatedTotal: 50000,
      }).then((quoteId) => {
        // The app's own dispatch endpoints (assistant flow / quote review).
        cy.apiSendQuoteEmail(quoteId);
        cy.request({
          method: "POST",
          url: `/api/quotes/${quoteId}/text`,
          failOnStatusCode: false,
        });
        // Today red: email subject "Nuevo usuario Quote for Cliente Texto, …"
        // and SMS content "Hi Cliente, this is Nuevo." A fix may instead
        // refuse the send (needs-name) — then no message exists, which passes.
        messagesFor(quoteId).then((msgs) => {
          for (const m of msgs) {
            const copy = `${m.subject ?? ""}\n${m.body ?? ""}\n${m.content ?? ""}`;
            expect(copy).not.to.match(PLACEHOLDER);
            expect(copy).not.to.match(/\bthis is Nuevo\b/);
            expect(copy).not.to.match(/\bsoy Nuevo\b/);
            expect(copy).not.to.contain("Nuevo preparó");
          }
        });
      });
    });
  });
});
