/// <reference types="cypress" />

/**
 * UX-36 + UX-37 regression — the SINGLE signature ceremony.
 *
 * The Contract entity is gone: the quote IS the "Quote + Agreement", /q/:id
 * is the ONE customer surface, and accepting the quote there is the one
 * signature ceremony (it also creates the milestone invoices from the
 * quote's payment terms).
 *
 *   UX-37 is resolved by construction — there is no second ceremony/page:
 *         a second accept 409s {reason:"already_accepted"}, the accepted /q
 *         renders evidence (never a fresh pad), and /c/:id no longer exists.
 *   UX-36 still holds via reconcile — accepting an already-invoiced (here:
 *         already PAID-in-full) deal bills only the unbilled remainder, so
 *         no phantom milestone pair ever lands on /invoices.
 *
 * Server grounding (read post-merge):
 *   - POST /api/quotes/:id/accept (backend/src/paperwork/entrypoints/
 *     public-controller/mod.ts): 409 {reason:"already_accepted"} when
 *     isAccepted; on success AWAITS SendSignedConfirmation.run(quoteId),
 *     which computes milestones from quote.terms payment_terms, reconciles
 *     against existing invoices matched by quoteId (UX-36), and stamps
 *     quote.acceptedNotifiedAt as its replay guard — so the invoices exist
 *     by the time the accept response lands (no settle wait needed).
 *   - front-end: /q renders QuoteDoc; the pad is `form.ctr__sign-form`
 *     (PublicSignQuote) with the page's only <canvas>; the pending pill is
 *     quoteDoc.awaiting ("Awaiting signature"); the accepted state shows
 *     the "Signed {date}" pill + "Signed and binding" strip. The /c route
 *     is deleted (Fresh 404).
 *
 * Repeatability on a long-lived dev KV: the deal amount is derived from
 * Date.now() at spec load, so leftovers from a previous run render a
 * different half-amount and can't collide with this run's assertions.
 *
 * Phones used (this file only): +15125556620 (contractor), +15125556621
 * (customer).
 */

// Module scope (export {} at the bottom) so these consts can't collide with
// other specs — cy files without imports compile as global scripts.
const PHONE = "+15125556620";
const CUSTOMER = { name: "Casey Buyer", phoneNumber: "+15125556621" };

// Unique-per-run whole-dollar amounts (see header). HALF ∈ [$1,000..$9,999].
const HALF_DOLLARS = 1000 + (Date.now() % 9000);
const HALF_CENTS = HALF_DOLLARS * 100;
const TOTAL_CENTS = HALF_CENTS * 2;

// The UX-36 deal uses its OWN amount pair: the UX-37 deal above now
// legitimately bills a HALF_CENTS milestone pair on accept (accept always
// bills), and both deals share the contractor — so the UX-36 "no phantom
// milestone" assertion must key on a number no legit invoice can render.
// The +4567 offset can never collide with HALF_DOLLARS mod 9000.
const HALF2_DOLLARS = 1000 + ((Date.now() + 4567) % 9000);
const HALF2_CENTS = HALF2_DOLLARS * 100;
const TOTAL2_CENTS = HALF2_CENTS * 2;
const HALF2_STR = "$" + HALF2_DOLLARS.toLocaleString("en-US");

const TERMS_50_50 = [
  { stepId: "payment_terms", label: "Payment terms", value: "50 / 50" },
];

describe("UX-37 one ceremony: a second accept 409s and no second surface exists", () => {
  let quoteId: string;

  before(() => {
    cy.clearCookies();
    cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "en", name: "Dana Contractor" });
    cy.apiUpdateProfile({ businessName: "DOUBLE SIGN LLC" });
    cy.apiCreateCustomer(CUSTOMER).then((customerId: string) => {
      cy.apiCreateQuote({
        summary: "Deck rebuild with new railing",
        jobName: "Deck Rebuild",
        customerId,
        lineItems: [
          {
            description: "Deck rebuild",
            quantity: 1,
            unit: "job",
            price: TOTAL_CENTS,
          },
        ],
        estimatedTotal: TOTAL_CENTS,
        terms: TERMS_50_50,
      }).then((qId: string) => {
        quoteId = qId;
        // The ONE ceremony: the customer accept-signs on /q.
        cy.apiAcceptQuote(qId, {
          name: CUSTOMER.name,
          signature: CUSTOMER.name,
        }).then((r) => expect(r.status).to.be.lessThan(400));
      });
    });
  });

  it("UX-37: accepting a second time is a 409 conflict, never a silent success", () => {
    cy.apiAcceptQuote(quoteId, {
      name: "Somebody Else",
      signature: "Somebody Else",
    }).then((r) => {
      expect(r.status).to.eq(409);
      const body = r.body as { ok?: boolean; reason?: string };
      expect(body.ok).to.eq(false);
      expect(body.reason).to.eq("already_accepted");
    });
  });

  it("UX-37: the milestone invoices were created exactly once despite the double accept", () => {
    cy.loginAs(PHONE);
    cy.request("/api/invoices").then((res) => {
      const rows = (res.body as Array<{ quoteId?: string; amount?: number }>)
        .filter((i) => i.quoteId === quoteId);
      // 50/50 on TOTAL → exactly one milestone pair; the rejected second
      // accept must not have re-billed (acceptedNotifiedAt replay guard +
      // the 409 short-circuit).
      expect(rows, "one 50/50 milestone pair, created once").to.have.length(2);
      expect(rows.map((r) => r.amount).sort()).to.deep.eq([
        HALF_CENTS,
        HALF_CENTS,
      ]);
    });
  });

  it("UX-37: the accepted /q renders evidence, never a fresh signature pad", () => {
    // Customer context — /q localizes off pm_lang; EN keeps the asserted
    // strings deterministic (Spanish-first app).
    cy.clearCookies();
    cy.setCookie("pm_lang", "en");
    cy.visit(`/q/${quoteId}`);

    // Wait for the client-fetched document (PublicQuoteView paints a
    // skeleton first) — the hero title is the quote's jobName.
    cy.contains(/deck rebuild/i, { timeout: 10_000 }).should("be.visible");

    // No ceremony chrome anywhere on the accepted document.
    cy.get("form.ctr__sign-form").should("not.exist"); // PublicSignQuote form
    cy.get("canvas").should("not.exist"); // the draw pad
    cy.contains(/awaiting signature/i).should("not.exist"); // pending pill

    // The accepted rendering instead: the "Signed {date}" pill and the
    // "Signed and binding" strip (quote-doc.tsx signed branch).
    // (No \b-anchored body-text regex here: .text() concatenates element
    // text, gluing digits onto "Signed" — "…F468Signed" has no boundary.)
    cy.contains(/signed and binding/i).should("be.visible");
    cy.contains(/signed august|signed \w+ \d/i).should("be.visible");
  });

  it("UX-37: the old /c ceremony page no longer exists", () => {
    cy.request({ url: `/c/${quoteId}`, failOnStatusCode: false })
      .its("status")
      .should("eq", 404);
  });
});

describe("UX-36 accepting an already-paid deal bills only the unbilled remainder", () => {
  it("UX-36: accept after paid-in-full creates no phantom milestones", () => {
    cy.clearCookies();
    cy.loginAs(PHONE);

    // Fresh deal for the money loop (same contractor, new quote).
    cy.apiCreateCustomer({
      name: "Casey Buyer",
      phoneNumber: "+15125556621",
    }).then((customerId: string) => {
      cy.apiCreateQuote({
        summary: "Bathroom retile",
        jobName: "Bathroom Retile",
        customerId,
        lineItems: [
          {
            description: "Retile",
            quantity: 1,
            unit: "job",
            price: TOTAL2_CENTS,
          },
        ],
        estimatedTotal: TOTAL2_CENTS,
        terms: TERMS_50_50,
      }).then((quoteId: string) => {
        // Invoice the FULL amount up front → claim → confirm (paid), and
        // only THEN the customer accepts on /q. The reconcile (matched by
        // quoteId) finds zero unbilled remainder, so accept bills nothing.
        cy.apiCreateInvoice({
          quoteId,
          customerId,
          amount: TOTAL2_CENTS,
          dueDate: new Date(Date.now() + 6 * 24 * 3600 * 1000)
            .toISOString()
            .slice(0, 10),
          status: "sent",
          installmentIndex: 1,
          installmentTotal: 1,
        }).then((invoiceId: string) => {
          cy.apiClaimPayment(invoiceId, {
            method: "zelle",
            claimedBy: "Casey Buyer",
          }).then((r) => expect((r.body as { ok?: boolean }).ok).to.eq(true));
          cy.apiConfirmPayment(invoiceId).then((r) =>
            expect((r.body as { ok?: boolean }).ok).to.eq(true)
          );
          // The late accept — the one ceremony, on the already-paid deal.
          cy.apiAcceptQuote(quoteId, {
            name: "Casey Buyer",
            signature: "Casey Buyer",
          }).then((r) => expect((r.body as { ok?: boolean }).ok).to.eq(true));

          // API truth first: still exactly ONE invoice on this quote (the
          // paid one) — the accept awaited send-signed-confirmation, so a
          // regression would already be visible here.
          cy.request("/api/invoices").then((res) => {
            const rows = (res.body as Array<
              { quoteId?: string; amount?: number; status?: string }
            >).filter((i) => i.quoteId === quoteId);
            expect(rows, "no new milestones beyond the paid invoice").to.have
              .length(1);
            expect(rows[0].status).to.eq("paid");
          });
        });
      });
    });

    // UI truth: /invoices shows no fresh HALF milestone pair.
    cy.visit("/invoices?lang=en");
    // The hero renders only once the invoice list has loaded
    // (InvoicesPage.tsx data-cy="forecast-hero").
    cy.get('[data-cy="forecast-hero"]', { timeout: 10_000 }).should(
      "be.visible",
    );
    // Small settle for the separately-fetched forecast breakdown.
    cy.wait(1500);

    // "$H,HHH" (HALF2) is also a prefix of the exact form "$H,HHH.00", so this
    // covers fmtMoney and fmtMoneyExact renderings.
    cy.contains(HALF2_STR).should("not.exist");
  });
});

export {};
