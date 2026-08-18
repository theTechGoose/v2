/// <reference types="cypress" />

/**
 * P-09 [OUTBOUND] "Sends report success when delivery failed."
 *
 * The invoice email/text endpoints return HTTP 200 + {ok:false, reason:"no
 * recipient: …"} when the customer has no email/phone (live-proven), but
 * InvoicesPage.tsx checks only Response.ok and reloads as success:
 *   - dispatchInvoice (InvoicesPage.tsx:1422-1435) → "Send now" (scheduled
 *     card CTA, doSendNow:1565) and "Finish + send" (drafting card CTA,
 *     doFinishDraft:1585) fire both channels and reload unconditionally
 *   - doSendText (InvoicesPage.tsx:1551-1564) → `if (r.ok) reload()`
 * A contractor whose customer is unreachable believes the invoice was
 * delivered. Desired: the send surface shows a FAILURE state (the honest
 * "no email on file"-style copy the contract-send divider path uses — lang
 * keys sendContract.divider.noEmail "Contract drafted — no email on file for
 * this customer. Add one to deliver." / sendContract.divider.emailFailed
 * "Contract email failed — {reason}" / invoicesPage.new.needContact "Add an
 * email or phone for this client to send it.") and nothing records the
 * invoice as successfully sent.
 *
 * NOTE on the assistant swap-invoice surface (AsstChat.tsx:3043-3049, which
 * ignores the send result entirely): it is not cheaply drivable e2e (it sits
 * behind the assistant finished-flow review); its honest-result contract is
 * covered by jest/unit/send-result.test.ts, whose header names it as a
 * wiring site.
 *
 * Selectors grounded in InvoicesPage.tsx: [data-cy=invoice-cta-scheduled]
 * ("Send now" — invoicesPage.cta.scheduled), [data-cy=invoice-cta-drafting]
 * ("Finish + send" — invoicesPage.cta.drafting), card container .qcard
 * showing the customer name (inv.client).
 */

const PHONE = "+15125552410";

/** Honest failure copy, grounded in lang/en.json (see header). None of these
 * strings appear on today's /invoices page after the silent reload — the
 * visibility assertion is the RED driver. */
const FAILURE_COPY =
  /no email on file|add an email|email failed|not delivered|couldn['’]t send/i;

function assertNoEmailRecordedAsSent(invoiceId: string) {
  cy.request("/api/messages").then(({ body }) => {
    const all: Array<Record<string, unknown>> = Array.isArray(body)
      ? body
      : (body as { items?: Array<Record<string, unknown>> })?.items ?? [];
    const emailForInvoice = all.filter((m) =>
      (m.channel === "email" || m.kind === "email") &&
      JSON.stringify(m).includes(invoiceId)
    );
    expect(
      emailForInvoice,
      "no email-channel message recorded as sent for the undeliverable invoice",
    ).to.have.length(0);
  });
}

describe("P-09 invoice send surfaces report failure honestly (customer with no email)", () => {
  beforeEach(() => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "en"); // EN copy asserted (Spanish-first app)
    cy.loginAs(PHONE);
    cy.request("POST", "/api/me/onboarded", { skipped: true });
    cy.apiUpdateUser({ language: "en" }); // fresh users default to es
  });

  it("P-09 'Send now' on a scheduled invoice for an unreachable customer shows a failure state, not silent success", () => {
    // Unique per run: the phone accumulates cards across runs, so the card is
    // located by its customer name.
    const clientName = `No Email Nora ${Date.now()}`;
    cy.apiCreateCustomer({ name: clientName }).then((customerId: string) => {
      cy.apiCreateInvoice({
        customerId,
        jobName: "Undeliverable Job",
        amount: 12300,
        dueDate: "2099-01-01",
        status: "scheduled",
        scheduledFor: "2099-01-01",
      }).then((invoiceId: string) => {
        cy.visit("/invoices");
        cy.contains(".qcard", clientName, { timeout: 10_000 })
          .scrollIntoView()
          .find("[data-cy=invoice-cta-scheduled]")
          .click();

        // DESIRED: the UI surfaces the delivery failure. Today dispatchInvoice
        // ignores the {ok:false} body and reloads as success — no failure copy
        // ever appears, so this is RED.
        cy.contains(FAILURE_COPY, { timeout: 10_000 }).should("be.visible");

        // And nothing may present the invoice as sent/delivered:
        cy.request(`/api/invoices/${invoiceId}`)
          .its("body.status")
          .should("not.eq", "sent");
        assertNoEmailRecordedAsSent(invoiceId);
      });
    });
  });

  it("P-09 'Finish + send' on a draft for an unreachable customer surfaces the delivery failure instead of quietly reloading", () => {
    const clientName = `No Email Ned ${Date.now()}`;
    cy.apiCreateCustomer({ name: clientName }).then((customerId: string) => {
      cy.apiCreateInvoice({
        customerId,
        jobName: "Undeliverable Draft",
        amount: 45600,
        dueDate: "2099-01-01",
        status: "draft",
      }).then((invoiceId: string) => {
        cy.visit("/invoices");
        cy.contains(".qcard", clientName, { timeout: 10_000 })
          .scrollIntoView()
          .find("[data-cy=invoice-cta-drafting]")
          .click();

        // DESIRED: finalizing the draft may proceed, but the DELIVERY failure
        // must be surfaced — the contractor must not walk away believing the
        // invoice reached the customer. Today: silent reload, card lands in
        // "Out for payment" with zero indication nothing was delivered → RED.
        cy.contains(FAILURE_COPY, { timeout: 10_000 }).should("be.visible");

        // Nothing recorded as a successful email send for it.
        assertNoEmailRecordedAsSent(invoiceId);
      });
    });
  });
});
