/// <reference types="cypress" />

/**
 * RED (TDD) desktop specs (1440×900) for the /invoices detail surface and the
 * /quotes receipts strip. They assert the DESIRED end state; today's UI is buggy
 * so they fail.
 *
 * P-31 [DESKTOP] "/invoices detail panel looks bolted-on and hides its own
 *   controls." The audited panel is the CLAIMED invoice's FLIP-CARD BACK
 *   (`.qcard__back`, opened by clicking a card) — the panel with the
 *   "$3,200 · Awaiting confirmation" header, the "Adjust invoice" toggle and
 *   the four-button footer. Audit measured: `.qcard__back-head` clientHeight 61
 *   vs scrollHeight 92 (overflow:hidden clip); `.qcard__back-body` hides 203 of
 *   419px behind an inner scroll (overflow-y:auto); an EMPTY `.qcard__read`
 *   coral bar; a `.qcard__back-foot` of four identical outlined buttons (no
 *   primary). Desired: header fully visible, controls reachable, no empty alert,
 *   exactly one solid primary.
 *
 * P-32 [QUOTES] "The receipts strip counts self-notifications as customer
 *   sends." After a send + a customer open + an accept, the strip shows the
 *   accepted-alert SMS to the contractor's OWN phone as a delivery, and shows no
 *   "viewed by the customer" receipt. Desired: only customer-facing deliveries,
 *   plus a viewed receipt.
 *
 * P-41 [INVOICES] "Integrity gaps in adjustments." A customer-approved change
 *   order still offers Edit/Delete; a discount applied while a payment claim is
 *   pending silently changes the total. Desired: no Edit/Delete on an approved
 *   CO; a pending-claim discount is blocked (per the audit — no warning copy key
 *   exists yet).
 */

/** True when a computed background-color is a real solid fill (not transparent,
 *  not white/near-white) — the mark of a primary/solid button vs an outlined one. */
function isSolidFill(bg: string): boolean {
  const m = String(bg).match(/rgba?\(([^)]+)\)/);
  if (!m) return false;
  const [r, g, b, a = 1] = m[1].split(",").map((x) => parseFloat(x.trim()));
  if (a === 0) return false; // transparent
  if (r >= 240 && g >= 240 && b >= 240) return false; // white / near-white
  return true;
}

describe("P-31 the claimed invoice flip-card panel shows its own header + controls", () => {
  const PHONE = "+15125552830";
  let invoiceId: string;

  beforeEach(() => {
    cy.viewport(1440, 900);
    cy.clearCookies();
    cy.setCookie("pm_lang", "en"); // re-pin EN after the wipe (Spanish-first app)
    cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "en" });
    cy.request({
      method: "POST",
      url: "/api/me/onboarded",
      body: { skipped: true },
      failOnStatusCode: false,
    });
    cy.seedQuoteToCash({ invoice: { amount: 320000 } }).then((seeded) => {
      invoiceId = seeded.invoiceId;
      // Claim it so it lands in "Awaiting confirmation" — the audited state.
      cy.apiClaimPayment(invoiceId, { method: "zelle", claimedBy: "Asha Patel" });
    });
  });

  function openFlippedCard() {
    cy.visit("/invoices");
    cy.get("[data-cy=awaiting-confirmation-track] .qcard", { timeout: 10_000 })
      .first()
      .as("card");
    cy.get("@card").find(".qcard__title").scrollIntoView().click();
    cy.get("@card").should("have.class", "qcard--flipped");
  }

  it("P-31 the header is fully visible — nothing clipped", () => {
    openFlippedCard();
    cy.get("@card").find(".qcard__back-head").then(($h) => {
      const el = $h[0] as HTMLElement;
      expect(el.scrollHeight, "back-head must not clip its content")
        .to.be.at.most(el.clientHeight + 1);
    });
  });

  it("P-31 there is no EMPTY coral alert bar", () => {
    openFlippedCard();
    cy.get("@card").then(($card) => {
      $card.find(".qcard__read").each((_i, el) => {
        expect((el.textContent || "").trim(), "coral alert bar must not be empty")
          .to.not.equal("");
      });
    });
  });

  it("P-31 the action row has exactly ONE solid/primary button", () => {
    openFlippedCard();
    cy.get("@card").find(".qcard__back-foot").then(($foot) => {
      const solid = $foot.find("button, a").toArray().filter((b) =>
        isSolidFill(getComputedStyle(b).backgroundColor)
      );
      expect(solid.length, "exactly one solid/primary action").to.equal(1);
    });
  });

  it("P-31 the Discount / Change order controls are reachable — not behind an inner scroll", () => {
    openFlippedCard();
    cy.get("@card").contains("button", /adjust invoice|ajustar factura/i).click();
    // the controls are rendered…
    cy.get("@card").contains(/discount|descuento/i).should("exist");
    // …and the panel body does not trap them behind a hidden inner scroll.
    cy.get("@card").find(".qcard__back-body").then(($b) => {
      const el = $b[0] as HTMLElement;
      expect(el.scrollHeight, "adjustment controls must not hide behind an inner scroll")
        .to.be.at.most(el.clientHeight + 1);
    });
  });
});

describe("P-32 the /quotes receipts strip shows only customer deliveries + a viewed receipt", () => {
  const PHONE = "+15125552831"; // the contractor's OWN phone
  const SELF_DIGITS = "5552831"; // distinctive tail of the contractor's own number
  const CUSTOMER_EMAIL = "maria.cy@blackhole.postmarkapp.com";
  let quoteId: string;

  beforeEach(() => {
    cy.viewport(1440, 900);
    cy.clearCookies();
    cy.setCookie("pm_lang", "en");
    cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "en" });
    cy.request({
      method: "POST",
      url: "/api/me/onboarded",
      body: { skipped: true },
      failOnStatusCode: false,
    });
    cy.apiCreateCustomer({
      name: "Maria Cliente",
      email: CUSTOMER_EMAIL,
      phoneNumber: "+15125552891",
    }).then((customerId: string) => {
      cy.apiCreateQuote({
        summary: "Backyard cleanup",
        jobName: "Backyard Junk Removal",
        lineItems: [{ description: "Junk removal", quantity: 1, unit: "job", price: 320000 }],
        estimatedTotal: 320000,
        customerId,
      }).then((qid: string) => {
        quoteId = qid;
        cy.apiSendQuoteEmail(qid); // ONE customer-facing email send
        // Customer opens the quote (records viewedAt) — anonymous.
        cy.clearCookies();
        cy.setCookie("pm_lang", "en");
        cy.request("/api/quotes/" + qid + "/public");
        // Customer approves → fires the accepted-alert (SMS to the contractor's OWN phone).
        cy.apiAcceptQuote(qid, { name: "Maria Cliente" });
        cy.wait(3000); // let the fire-and-forget accepted-alert flush to /messages
        // Back to the contractor to read the strip.
        cy.setCookie("pm_lang", "en");
        cy.loginAs(PHONE);
        cy.apiUpdateUser({ language: "en" });
      });
    });
  });

  it("P-32 no self-phone receipt, and a customer-viewed receipt is shown", () => {
    cy.visit(`/quotes?open=${quoteId}`);
    cy.get("[data-cy=quote-open-panel]", { timeout: 10_000 }).should("exist");
    cy.get(".qopen__receipts", { timeout: 10_000 }).should("exist");
    // The genuine customer email send survives.
    cy.get(".qopen__receipts").should("contain.text", CUSTOMER_EMAIL);
    // …but the accepted-alert SMS to the contractor's OWN phone must NOT appear.
    cy.get(".qopen__receipts").should("not.contain.text", SELF_DIGITS);
    // …and a "viewed by the customer" receipt DOES appear (viewedAt exists server-side).
    cy.get(".qopen__receipts").invoke("text").should(
      "match",
      /viewed|vista|opened|abri[óo]|seen|vio/i,
    );
  });
});

describe("P-41 adjustment integrity in the invoice UI", () => {
  const PHONE = "+15125552832";
  let invoiceId: string;

  beforeEach(() => {
    cy.viewport(1440, 900);
    cy.clearCookies();
    cy.setCookie("pm_lang", "en");
    cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "en" });
    cy.request({
      method: "POST",
      url: "/api/me/onboarded",
      body: { skipped: true },
      failOnStatusCode: false,
    });
    cy.seedQuoteToCash({ invoice: { amount: 320000 } }).then((seeded) => {
      invoiceId = seeded.invoiceId;
    });
  });

  it("P-41 an approved change order offers no Edit / Delete", () => {
    cy.request("POST", `/api/invoices/${invoiceId}/change-orders`, {
      description: "Haul extra debris",
      deltaAmountCents: 15000,
    }).then(({ body }) => {
      const coId = body.id as string;
      cy.request("POST", `/api/change-orders/${coId}/approve`, { name: "Asha Patel" });

      cy.visit("/invoices");
      // The "sent" invoice sits in the Out-for-payment track; find + flip its card.
      cy.get("[data-cy=invoice-cta-out]", { timeout: 10_000 }).closest(".qcard").as("card");
      cy.get("@card").find(".qcard__title").scrollIntoView().click();
      cy.get("@card").should("have.class", "qcard--flipped");
      cy.get("@card").contains("button", /adjust invoice|ajustar factura/i).click();

      // The approved change order row is visible…
      cy.get("@card").contains(/approved|aprobada/i, { timeout: 10_000 }).should("exist");
      // …and offers NO Edit / Delete affordance.
      cy.get("@card").within(() => {
        cy.contains("button", /edit|editar/i).should("not.exist");
        cy.contains("button", /delete|eliminar/i).should("not.exist");
      });
    });
  });

  it("P-41 a discount does not silently apply while a payment claim is pending", () => {
    cy.apiClaimPayment(invoiceId, { method: "zelle", claimedBy: "Asha Patel" });

    cy.visit("/invoices");
    cy.get("[data-cy=awaiting-confirmation-track] .qcard", { timeout: 10_000 })
      .first()
      .as("card");
    cy.get("@card").find(".qcard__title").scrollIntoView().click();
    cy.get("@card").should("have.class", "qcard--flipped");
    cy.get("@card").contains("button", /adjust invoice|ajustar factura/i).click();

    // Knock $100 off (discount input is the first number field in the panel).
    cy.get("@card").find("input[type=number]").first().type("100");
    cy.get("@card").contains("button", /^\s*(apply|aplicar)\s*$/i).click();

    // Desired (audit fallback: no warning-copy key exists yet) — the flow is
    // BLOCKED, so the total is NOT silently reduced from $3,200.
    cy.wait(500);
    cy.request(`/api/invoices/${invoiceId}`).its("body.amount").should("eq", 320000);
  });
});
