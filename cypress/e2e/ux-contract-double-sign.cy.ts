/// <reference types="cypress" />

/**
 * RED (TDD) — UX-37 + UX-36 in the real UI.
 *
 *   UX-37 "Two independent signature ceremonies exist for one agreement." —
 *         after the customer accept-signed the quote on /q, visiting /c for
 *         the SAME deal must NOT offer a fresh signature ceremony (no pad,
 *         no "Awaiting signature") — it must render the already-accepted
 *         evidence instead.
 *   UX-36 "Signing the contract after the job was invoiced and paid
 *         DOUBLE-BILLS the customer." — after the paid-then-signed sequence
 *         the contractor's /invoices must NOT show new milestone amounts
 *         beyond the agreement total (live repro: a fresh $1,850 × 2 pair on
 *         an already-paid $3,700 job).
 *
 * Selector grounding (read on 2026-08-19):
 *   - front-end/islands/PublicSignContract.tsx:317-319 — the ceremony form is
 *     `<form class="ctr__sign-form">`; :407-415 — the draw pad is the only
 *     <canvas> on the page.
 *   - front-end/components/contract-doc.tsx:345-351 — the pending pill text
 *     is contractDoc.awaiting ("Awaiting signature" / "Pendiente de firma");
 *     :532-604 — the unsigned branch mounts PublicSignContract (:599-602).
 *   - lang/en.json: only contractDoc.signed ("Signed {date}") and
 *     contractDoc.signedBinding ("Signed and binding") contain the whole word
 *     "signed" — today's accepted-quote /c page contains NEITHER "signed"
 *     nor "accepted" as a whole word ("By signing below…" doesn't match), so
 *     the evidence assertion is red today and satisfied by BOTH fix shapes
 *     (signed state, or an explicit already-accepted notice).
 *   - front-end/islands/InvoicesPage.tsx:639 (data-cy="forecast-hero",
 *     rendered only after the invoice list loads) and lib/format.ts fmtMoney/
 *     fmtMoneyExact — a milestone of H dollars renders as "$H,HHH" or
 *     "$H,HHH.00"; asserting the no-cents string absent covers both.
 *
 * Server grounding: milestone auto-creation fires fire-and-forget from
 * POST /contracts/:id/sign (backend/src/paperwork/entrypoints/
 * public-controller/mod.ts:772 → send-signed-confirmation/mod.ts:136-185);
 * probed latency ≈1-2s, hence the explicit wait before visiting /invoices.
 *
 * Repeatability on a long-lived dev KV: the deal amount is derived from
 * Date.now() at spec load, so a leftover milestone pair from a PREVIOUS
 * (unfixed) run renders a different half-amount and can't collide with this
 * run's absence assertion. Whole-dollar 4-digit halves keep the rendered
 * string unambiguous ("$N,NNN").
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
const HALF_STR = "$" + HALF_DOLLARS.toLocaleString("en-US");

const TERMS_50_50 = [
  { stepId: "payment_terms", label: "Payment terms", value: "50 / 50" },
];

describe("UX-37 /c offers no second ceremony after the /q acceptance", () => {
  let customerId: string;
  let quoteId: string;
  let contractId: string;

  before(() => {
    cy.clearCookies();
    cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "en", name: "Dana Contractor" });
    cy.apiUpdateProfile({ businessName: "DOUBLE SIGN LLC" });
    cy.apiCreateCustomer(CUSTOMER).then((id: string) => {
      customerId = id;
      cy.apiCreateQuote({
        summary: "Deck rebuild with new railing",
        jobName: "Deck Rebuild",
        customerId: id,
        lineItems: [
          {
            description: "Deck rebuild",
            quantity: 1,
            unit: "job",
            price: TOTAL_CENTS,
          },
        ],
        estimatedTotal: TOTAL_CENTS,
      }).then((qId: string) => {
        quoteId = qId;
        cy.apiCreateContract({
          quoteId: qId,
          customerId: id,
          totalAmount: TOTAL_CENTS,
          terms: TERMS_50_50,
        }).then((cId: string) => {
          contractId = cId;
        });
        // The FIRST ceremony: the customer accept-signs on /q.
        cy.apiAcceptQuote(qId, {
          name: CUSTOMER.name,
          signature: CUSTOMER.name,
        }).then((r) => expect(r.status).to.be.lessThan(400));
      });
    });
  });

  it("UX-37: /c renders the already-accepted evidence, never a fresh signature pad", () => {
    // Customer context — the /c page localizes off pm_lang; EN keeps the
    // asserted strings deterministic (Spanish-first app).
    cy.clearCookies();
    cy.setCookie("pm_lang", "en");
    cy.visit(`/c/${contractId}`);

    // Wait for the client-fetched document (PublicContractView paints a
    // skeleton first) — the hero title is the quote's jobName.
    cy.contains(/deck rebuild/i, { timeout: 10_000 }).should("be.visible");

    // RED today: the full second ceremony renders.
    // Pad form — PublicSignContract.tsx:319.
    cy.get("form.ctr__sign-form").should("not.exist");
    // Draw pad canvas — PublicSignContract.tsx:407.
    cy.get("canvas").should("not.exist");
    // Pending pill — contract-doc.tsx:345-351 / lang/en.json contractDoc.awaiting.
    cy.contains(/awaiting signature/i).should("not.exist");

    // And the page must show the accepted rendering instead. Both fix shapes
    // inevitably introduce "signed"/"accepted" wording (signed pill + strip,
    // or an "you already accepted this on <date>" notice); today's page
    // contains neither word (only "signing").
    cy.get("body")
      .invoke("text")
      .should((text: string) => {
        expect(text).to.match(/\b(signed|accepted|aceptaste)\b/i);
      });
  });
});

describe("UX-36 /invoices shows no phantom milestones after a paid-then-signed deal", () => {
  it("UX-36: signing an already-paid deal adds no new milestone amounts beyond the total", () => {
    cy.clearCookies();
    cy.loginAs(PHONE);

    // Fresh deal for the money loop (same contractor, new quote + contract).
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
            price: TOTAL_CENTS,
          },
        ],
        estimatedTotal: TOTAL_CENTS,
      }).then((quoteId: string) => {
        cy.apiCreateContract({
          quoteId,
          customerId,
          totalAmount: TOTAL_CENTS,
          terms: TERMS_50_50,
        }).then((contractId: string) => {
          // accept → invoice the FULL amount → claim → confirm → sign.
          cy.apiAcceptQuote(quoteId, {
            name: "Casey Buyer",
            signature: "Casey Buyer",
          });
          cy.apiCreateInvoice({
            contractId,
            quoteId,
            customerId,
            amount: TOTAL_CENTS,
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
            }).then((r) =>
              expect((r.body as { ok?: boolean }).ok).to.eq(true)
            );
            cy.apiConfirmPayment(invoiceId).then((r) =>
              expect((r.body as { ok?: boolean }).ok).to.eq(true)
            );
            cy.apiSignContract(contractId, {
              name: "Casey Buyer",
              signature: "Casey Buyer",
            }).then((r) =>
              expect((r.body as { ok?: boolean }).ok).to.eq(true)
            );
          });
        });
      });
    });

    // Milestone auto-creation is fire-and-forget after the sign response
    // (probed ≈1-2s) — give it time so today's phantom pair is definitely
    // in the list before we assert its absence.
    cy.wait(3000);

    cy.visit("/invoices?lang=en");
    // The hero renders only once the invoice list has loaded
    // (InvoicesPage.tsx:639, data-cy="forecast-hero").
    cy.get('[data-cy="forecast-hero"]', { timeout: 10_000 }).should(
      "be.visible",
    );
    // Small settle for the separately-fetched forecast breakdown.
    cy.wait(1500);

    // RED today: the fresh HALF milestone pair ("$H,HHH" sent + scheduled)
    // renders on the page (tracks and/or forecast hero) even though the job
    // was already paid in full. "$H,HHH" is also a prefix of the exact form
    // "$H,HHH.00", so this covers fmtMoney and fmtMoneyExact renderings.
    cy.contains(HALF_STR).should("not.exist");
  });
});

export {};
