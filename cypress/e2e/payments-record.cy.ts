/// <reference types="cypress" />

/**
 * REQ-019 — NW-33 (p29): "'Record a payment' takes you to the quote/invoice
 * chat. What is that button for?" Both hero actions on /payments used to
 * pre-fill the assistant composer and stop. Desired: "Record a payment"
 * records one in-page (pick the unpaid invoice → how they paid → amount →
 * date); "Export this month" downloads this month's payments CSV.
 */
describe("REQ-019 NW-33 /payments — Record a payment and Export this month do real things", () => {
  const PHONE = "+15125550945";
  const JOB = "Cash Deck Job";

  beforeEach(() => {
    cy.viewport(1440, 900);
    cy.clearCookies();
    cy.setCookie("pm_lang", "en");
    cy.loginAs(PHONE);
    cy.request({ url: "/api/me/wipe", failOnStatusCode: false });
    cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "en" });
    cy.request({ method: "POST", url: "/api/me/onboarded", body: { skipped: true }, failOnStatusCode: false });
    cy.setCookie("pm_lang", "en");
    const today = new Date().toISOString().slice(0, 10);
    const due = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    cy.apiCreateCustomer({
      name: "Deck Customer",
      email: "deck.customer@blackhole.postmarkapp.com",
      phoneNumber: "+15125550946",
    }).then((customerId) => {
      cy.apiCreateInvoice({ customerId, amount: 45000, jobName: JOB, status: "sent", issuedDate: today, dueDate: due });
    });
    cy.visit("/payments");
  });

  it("REQ-019 'Record a payment' records a cash payment for the picked invoice without leaving /payments", () => {
    cy.get("[data-cy=payments-record]", { timeout: 15_000 }).should("be.visible").click();
    cy.get("[data-cy=payments-record-invoice]").should("be.visible").then(($sel) => {
      const opt = [...($sel[0] as HTMLSelectElement).options].find((o) => o.text.includes(JOB));
      expect(opt, `an option for "${JOB}"`).to.exist;
      cy.get("[data-cy=payments-record-invoice]").select(opt!.value);
    });
    cy.get("[data-cy=pay-method-cash]").click();
    cy.get("[data-cy=pay-received-amount]").should("have.value", "450");
    cy.get("[data-cy=pay-received-submit]").click();

    cy.location("pathname").should("eq", "/payments");
    // The landed payment card shows its method (the hero's rotated stubs are
    // aria-hidden decorations — assert on the real card list).
    cy.get(".qcard", { timeout: 15_000 }).contains(/\bcash\b/i).scrollIntoView().should("be.visible");
    cy.request("/api/payments").its("body").should((rows: Array<{ method: string; amount: number }>) => {
      expect(rows.some((r) => r.method === "cash" && r.amount === 45000)).to.eq(true);
    });
  });

  it("REQ-019 'Export this month' is a real CSV download for the current year + month", () => {
    const now = new Date();
    cy.get("[data-cy=payments-export]")
      .should("have.attr", "href")
      .and("match", /\/api\/invoices\/export\.csv\?year=\d{4}&month=\d{1,2}$/)
      .then((href) => {
        expect(String(href)).to.contain(`year=${now.getFullYear()}&month=${now.getMonth() + 1}`);
        cy.request(String(href)).then((res) => {
          expect(res.status).to.eq(200);
          expect(res.headers["content-type"]).to.match(/text\/csv/);
        });
      });
  });
});
