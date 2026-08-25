/// <reference types="cypress" />

/**
 * P-12 "[PUBLIC] The money pages ignore localization — /i and /co are
 * English-only. With pm_lang=es in the same browser that rendered /q
 * in Spanish: 'Bill to', 'Amount due', 'How would you like to pay?',
 * 'I sent it', 'Approve this change' — 100% EN chrome on the highest-stakes
 * customer surfaces."
 *
 * Desired: with the pm_lang=es cookie, /i/:id and /co/:id render their
 * chrome in Spanish — exactly like the /q agreement already does. All the
 * Spanish strings asserted below ALREADY exist in lang/es.json.
 */
describe("P-12 public money pages honor the customer's pm_lang=es", () => {
  const PHONE = "+15125552620";

  // The contractor is explicitly ENGLISH (fresh users default to es —
  // Spanish-first app), so any Spanish on the public pages can only come
  // from the customer's own pm_lang cookie. That is precisely the P-12 gap.
  beforeEach(() => {
    cy.clearCookies();
    cy.loginAs(PHONE);
    cy.request("POST", "/api/me/onboarded", { skipped: true });
    cy.apiUpdateUser({ language: "en" });
    // Accepted payment methods so the /i claim UI (chips + "I sent it")
    // renders for the customer.
    cy.apiUpdateProfile({
      acceptedPaymentMethods: {
        zelle: { enabled: true, handle: "pay@dev-business.example" },
      },
    });
  });

  function assertBodyLacks(english: string[]) {
    cy.get("body").invoke("text").then((text) => {
      for (const anchor of english) {
        expect(text, `EN chrome "${anchor}" must not render for pm_lang=es`)
          .not.to.include(anchor);
      }
    });
  }

  it("P-12 /i renders Spanish chrome (incl. the payment-claim flow) for a pm_lang=es customer", () => {
    cy.seedQuoteToCash().then(({ invoiceId }) => {
      cy.clearCookies();
      cy.setCookie("pm_lang", "es");
      cy.visit(`/i/${invoiceId}`);

      // Core Spanish anchors (lang/es.json):
      cy.contains("Facturar a", { timeout: 10_000 }).should("be.visible"); // publicInvoice.billTo
      cy.contains("Monto a pagar").should("be.visible"); // publicInvoice.amountDue
      cy.contains("¿Cómo quieres pagar?").should("be.visible"); // publicInvoiceClaim.howToPay

      // The EN chrome must be gone.
      assertBodyLacks([
        "Bill to",
        "Amount due",
        "How would you like to pay?",
        "Download PDF",
      ]);

      // The claim flow itself is localized: pick the method chip, then the
      // submit button reads "Ya lo envié" (publicInvoiceClaim.iSentIt), and
      // never the English "I sent it".
      cy.get("[data-cy=claim-method-zelle]").click();
      cy.get("[data-cy=claim-submit]")
        .should("be.visible")
        .invoke("text")
        .then((text) => {
          expect(text).to.include("Ya lo envié");
          expect(text).not.to.include("I sent it");
        });
    });
  });

  it("P-12 /co renders Spanish chrome for a pm_lang=es customer", () => {
    cy.seedQuoteToCash().then(({ invoiceId }) => {
      // Create the change order while the contractor session is live.
      // Body shape probed: POST /api/invoices/:id/change-orders
      //   { description: string, deltaAmountCents: number } → { id, … }
      cy.request("POST", `/api/invoices/${invoiceId}/change-orders`, {
        description: "Add second coat of paint",
        deltaAmountCents: 15_000,
      }).then((res) => {
        expect(res.status).to.be.lessThan(400);
        const changeOrderId = (res.body as { id: string }).id;

        cy.clearCookies();
        cy.setCookie("pm_lang", "es");
        cy.visit(`/co/${changeOrderId}`);

        // Spanish anchors (lang/es.json):
        cy.contains("Orden de cambio", { timeout: 10_000 })
          .should("be.visible"); // changeOrderPublic.heading
        cy.contains("Qué cambia").should("be.visible"); // changeOrderPublic.whatsChanging
        cy.contains("button", "Aprobar este cambio") // publicChangeOrderActions.approve
          .should("be.visible");
        cy.contains("button", "Rechazar").should("be.visible"); // publicChangeOrderActions.decline

        // The EN chrome must be gone.
        assertBodyLacks([
          "Approve this change",
          "Change order",
          "What's changing",
          "Decline",
        ]);
      });
    });
  });

  it("P-12 parity: the /q agreement stays Spanish in the same pm_lang=es session", () => {
    // Regression guard — the /q agreement already resolves the pm_lang
    // cookie (langFromCookie in its route), so this is expected GREEN
    // today. It pins the behavior the /i + /co fix must match. (/q now
    // renders the FULL Quote + Agreement — value block AND signature
    // ceremony — the old /c page is gone.)
    cy.seedQuoteToCash().then(({ quoteId }) => {
      cy.clearCookies();
      cy.setCookie("pm_lang", "es");

      cy.visit(`/q/${quoteId}`);
      // quoteDoc.contractValue (es) — the agreement's value block.
      cy.contains(/valor del acuerdo/i, { timeout: 10_000 })
        .should("be.visible");
      cy.get("body").invoke("text").should("not.include", "Agreement value");
      // …and the signature ceremony is Spanish on the same page.
      cy.contains(/firma|firmar/i).should("be.visible");
    });
  });
});
