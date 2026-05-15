/// <reference types="cypress" />

/**
 * Voice-driven payment capture.
 *
 * The UI side of voice capture (mic button + speech-to-text) varies by
 * browser, so the e2e coverage here exercises the backend pipeline
 * directly through the JSON endpoint:
 *
 *   POST /api/invoices/record-payment/voice  { transcript }
 *     → parses amount/method/payer
 *     → matches against open invoices
 *     → either records the payment (matchedInvoiceId set)
 *     → or returns a disambiguation list (multiple matches)
 *
 * If the contractor-facing UI grows a real mic button, replace these
 * with a flow that uses cy.stub(window.navigator.mediaDevices...) to
 * inject a known transcript.
 */
describe("voice payment capture", () => {
  const CONTRACTOR_EMAIL = "dev@paperworkmonster.com";

  beforeEach(() => cy.loginAs(CONTRACTOR_EMAIL));

  it("records when transcript matches exactly one open invoice", () => {
    cy.request("POST", "/api/customers", { name: "Hansen Family", email: "hansen@example.com" }).then((c) => {
      const customerId = (c.body as { id: string }).id;
      cy.request("POST", "/api/quotes", {
        summary: "Deck Build", lineItems: [], customerId,
      }).then((q) => {
        cy.request("POST", "/api/contracts", { quoteId: (q.body as { id: string }).id, customerId, totalAmount: 1800_00 }).then((ct) => {
          cy.request("POST", "/api/invoices", {
            contractId: (ct.body as { id: string }).id,
            customerId,
            amount: 1800_00,
            dueDate: "2099-01-01",
            status: "sent",
          }).then((iRes) => {
            const invoiceId = (iRes.body as { id: string }).id;
            cy.request("POST", "/api/invoices/record-payment/voice", {
              transcript: "Got $1,800 cash from the Hansens for the deck job",
            }).then((res) => {
              expect(res.body).to.have.property("matchedInvoiceId", invoiceId);
              expect(res.body).to.have.property("paymentId");
            });
          });
        });
      });
    });
  });

  it("returns disambiguation when transcript matches multiple invoices", () => {
    // Two customers, both owe $1,800. Transcript carries no name hint
    // → both candidates show up in the disambiguation list.
    cy.request("POST", "/api/customers", { name: "Hawthorne A" }).then((c1) => {
      cy.request("POST", "/api/customers", { name: "Hawthorne B" }).then((c2) => {
        cy.request("POST", "/api/quotes", { summary: "x", lineItems: [], customerId: (c1.body as { id: string }).id })
          .then((q1) => cy.request("POST", "/api/contracts", { quoteId: (q1.body as { id: string }).id }))
          .then((ct1) => cy.request("POST", "/api/invoices", {
            contractId: (ct1.body as { id: string }).id,
            customerId: (c1.body as { id: string }).id,
            amount: 1800_00, dueDate: "2099-01-01", status: "sent",
          }));
        cy.request("POST", "/api/quotes", { summary: "y", lineItems: [], customerId: (c2.body as { id: string }).id })
          .then((q2) => cy.request("POST", "/api/contracts", { quoteId: (q2.body as { id: string }).id }))
          .then((ct2) => cy.request("POST", "/api/invoices", {
            contractId: (ct2.body as { id: string }).id,
            customerId: (c2.body as { id: string }).id,
            amount: 1800_00, dueDate: "2099-01-01", status: "sent",
          }));

        cy.request("POST", "/api/invoices/record-payment/voice", {
          transcript: "Got $1,800 cash",
        }).then((res) => {
          // No matchedInvoiceId since multiple plausible matches.
          expect(res.body).to.not.have.property("matchedInvoiceId");
          expect((res.body as { disambiguation: unknown[] }).disambiguation.length).to.be.greaterThan(1);
        });
      });
    });
  });
});
