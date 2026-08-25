/// <reference types="cypress" />

/**
 * PDF p12 + p14 — the public Quote + Agreement document on /q/:id.
 *
 * The quote IS the agreement: /q renders the full document (job details,
 * terms, 14 legal clauses, signature block) and accepting it — via the
 * PublicSignQuote pad — is THE one signature ceremony. On success the
 * backend also creates the milestone invoices from the quote's payment
 * terms (send-signed-confirmation).
 *
 *   p12: heads with the JOB NAME as its title, has the plain-English deal
 *        section, the job details, and the agreement value block.
 *   p14 (SIGN HERE):
 *        "By signing below, <client> agrees to everything above."
 *        CONTRACTOR column: business name, "By: <person>", "Date: <date>"
 *        CUSTOMER column: "Sign & type name below"
 *
 * Grounding (read post-merge):
 *   - front-end/routes/q/[id].tsx → PublicQuoteView island (client-fetches
 *     /api/quotes/:id/public) → QuoteDoc (components/quote-doc.tsx).
 *   - Signature pad island front-end/islands/PublicSignQuote.tsx posts
 *     POST /api/quotes/:id/accept {name, signature} and reloads ~900ms
 *     after success so the persisted accepted state renders.
 *   - Accepted state: "Signed {date}" pill, "Both signatures captured.",
 *     the stored signature image, "Signed and binding" strip, and the
 *     "Download PDF" link to /api/quotes/:id/pdf (deriveQuoteView).
 */
describe("public quote — agreement anatomy + signature ceremony", () => {
  const PHONE = "+15125550941";
  let quoteId: string;

  before(() => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "en");
    cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "en" }); // fresh users default to es; EN copy asserted
    cy.apiUpdateProfile({ businessName: "HANS LLC" });
    cy.apiUpdateUser({ name: "Hans Pedersen" });
    cy.apiCreateCustomer({
      name: "Green Goblin",
      email: "goblin@example.com",
      phone: "+15125559876",
    }).then((customerId: string) => {
      cy.apiCreateQuote({
        summary: "Backyard junk removal",
        jobName: "Backyard Junk Removal",
        description:
          "Removing junk from a backyard and making sure no trash remains",
        customerId,
        lineItems: [
          { description: "Junk removal", quantity: 1, unit: "ea", price: 35_000 },
        ],
        estimatedTotal: 35_000,
        // Payment terms on the QUOTE (the wizard writes them here now) —
        // accepting must turn this into a 50/50 milestone invoice pair.
        terms: [
          { stepId: "payment_terms", label: "Payment terms", value: "50 / 50" },
        ],
      }).then((id: string) => {
        quoteId = id;
      });
    });
  });

  beforeEach(() => {
    cy.clearCookies(); // customer view
    cy.setCookie("pm_lang", "en"); // EN copy asserted below (Spanish-first app)
    cy.visit(`/q/${quoteId}`);
  });

  it("heads with the job name and shows the plain-English + value sections (p12)", () => {
    cy.contains(/backyard junk removal/i, { timeout: 10_000 }).should("be.visible");
    cy.contains(/plain english/i).should("be.visible");
    cy.contains(/job details/i).should("be.visible");
    // quoteDoc.contractValue now reads "Agreement value".
    cy.contains(/agreement value/i).should("be.visible");
  });

  it("carries the parties + effective-date line and the line-item table (p12 anatomy)", () => {
    // "Between <contractor> ('Contractor') and <client> ('Client') · effective <date>"
    cy.contains(/between .*contractor.*green goblin.*client/i, { timeout: 10_000 })
      .should("be.visible");
    cy.contains(/effective/i).should("be.visible");
    // DESCRIPTION / AMOUNT line-item table.
    cy.contains(/description/i).should("be.visible");
    cy.contains(/amount/i).should("be.visible");
  });

  it("the agreement KEEPS its terms (the p6 exclusion applies to the invoice, not here)", () => {
    // Flip side of invoice-parity: the agreement still carries the terms
    // block — the wizard-captured grid (Start / payment) + the legal clauses.
    cy.contains(/start|schedule/i).should("exist");
    cy.contains(/payment/i).should("exist");
    cy.contains(/warranty/i).should("exist"); // clause 7 always renders
    // The seeded payment_terms row renders in the term grid.
    cy.contains(/payment terms/i).should("exist");
    cy.contains("50 / 50").should("exist");
  });

  it("states 'By signing below, <client> agrees to everything above.' (p14)", () => {
    cy.contains(/by signing below,\s*green goblin agrees to everything above\./i)
      .should("be.visible");
  });

  it("contractor signature column shows the BUSINESS name with 'By: <person>' and the date (p14)", () => {
    cy.contains(/contractor signature/i)
      .parents("section, div")
      .first()
      .within(() => {
        cy.contains("HANS LLC").should("be.visible");
        cy.contains(/by:\s*hans pedersen/i).should("be.visible");
        cy.contains(/date:/i).should("be.visible");
      });
  });

  it("customer signature column instructs 'Sign & type name below' (p14)", () => {
    cy.contains(/your signature/i)
      .parents("section, div")
      .first()
      .within(() => {
        cy.contains(/sign & type name below/i).should("be.visible");
      });
  });

  it("keeps the signature aids — Undo and Clear — from the current design (p14: 'Everything else the same')", () => {
    cy.contains(/sign & type name below/i)
      .parents("section, div")
      .first()
      .within(() => {
        cy.contains("button", /undo/i).should("exist");
        cy.contains("button", /clear/i).should("exist");
      });
  });

  it("typing a name and signing accepts the quote — the ONE ceremony — and renders the signed state", () => {
    cy.intercept("POST", "**/api/quotes/*/accept").as("accept");

    // The typed legal name completes the signature (drawing is optional —
    // the island renders a cursive PNG from the typed name).
    cy.get("form.ctr__sign-form", { timeout: 10_000 })
      .find("input")
      .first()
      .type("Green Goblin");
    cy.contains("button", /^sign|firmar/i).click();

    // Accepting IS the signing: one POST /api/quotes/:id/accept carrying
    // the typed name + the signature PNG.
    cy.wait("@accept").then(({ request, response }) => {
      const body = request.body as { name?: string; signature?: string };
      expect(body.name).to.eq("Green Goblin");
      expect(body.signature, "signature data-URL").to.match(/^data:image\/png/);
      expect(response?.statusCode).to.eq(200);
    });

    // The island reloads ~900ms after success; the persisted accepted state
    // then renders (P-11): the signed strip, the stored signature mark, and
    // the agreement PDF download (P-63).
    cy.contains(/signed and binding/i, { timeout: 15_000 }).should("be.visible");
    cy.contains(/both signatures captured/i, { timeout: 10_000 }).should(
      "be.visible",
    );
    // The customer card fills with the captured signature image (P-40).
    cy.get('img[alt="Green Goblin"]', { timeout: 10_000 })
      .should("have.attr", "src")
      .and("match", /^data:image\/png/);
    // No second ceremony remains on the page.
    cy.get("form.ctr__sign-form").should("not.exist");
    // PDF parity with the invoice page (deriveQuoteView.pdfUrl).
    cy.contains("a", /download pdf/i)
      .should("have.attr", "href")
      .and("include", `/api/quotes/${quoteId}/pdf`);
  });

  it("accepting created the 50/50 milestone invoices from the quote's payment terms", () => {
    // Contractor context: the accept in the previous test awaited
    // send-signed-confirmation, so the milestone pair exists already.
    cy.loginAs(PHONE);
    cy.request("/api/invoices").then((res) => {
      const rows = (res.body as Array<{
        quoteId?: string;
        amount?: number;
        installmentIndex?: number;
        installmentTotal?: number;
      }>).filter((i) => i.quoteId === quoteId);
      expect(rows, "milestone invoices for the accepted quote").to.have.length(2);
      const amounts = rows.map((r) => r.amount).sort();
      expect(amounts).to.deep.eq([17_500, 17_500]);
      rows.forEach((r) => expect(r.installmentTotal).to.eq(2));
    });
  });
});
