/// <reference types="cypress" />

/**
 * REQ-022 — NW-31c (p28): "Upcoming — needs a 'send it later' button with a
 * date picker (if there is no start date, how do they know when to send the
 * invoice?)." The New-invoice modal gets a "Send on" date; with it set the
 * invoice lands in Upcoming with "Scheduled to send <date>"; the Upcoming
 * card back offers "Change date".
 */
describe("REQ-022 NW-31c Upcoming invoices — pick and change the send date", () => {
  const PHONE = "+15125552839";
  const JOB = "Final Deck Invoice";
  const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

  beforeEach(() => {
    cy.viewport(1440, 900);
    cy.clearCookies();
    cy.setCookie("pm_lang", "en");
    cy.loginAs(PHONE);
    cy.request({ url: "/api/me/wipe", failOnStatusCode: false });
    cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "en", name: "Schedule Contractor" });
    cy.request({ method: "POST", url: "/api/me/onboarded", body: { skipped: true }, failOnStatusCode: false });
    cy.setCookie("pm_lang", "en");
    cy.apiCreateCustomer({
      name: "Later Customer",
      email: "later.customer@blackhole.postmarkapp.com",
      phoneNumber: "+15125552840",
    });
  });

  it("REQ-022 a new invoice with a 'Send on' date lands in Upcoming, and 'Change date' moves it", () => {
    cy.visit("/invoices?new=1");
    cy.get("[data-cy=new-invoice-modal]", { timeout: 15_000 }).should("be.visible");
    cy.get("[data-cy=new-invoice-client]").select(1);
    cy.get("[data-cy=new-invoice-modal] input[inputmode=decimal], [data-cy=new-invoice-amount]").first().type("800");
    cy.get("[data-cy=new-invoice-modal] input[placeholder]").first().then(($el) => {
      if (($el.attr("placeholder") ?? "").match(/faucet|reparación|repair/i)) cy.wrap($el).type(JOB);
    });
    cy.get("[data-cy=new-invoice-due]").clear().type(iso(30));
    // The new control: "Send on".
    cy.get("[data-cy=invoice-schedule-date]").should("be.visible").type(iso(5));
    cy.get("[data-cy=new-invoice-draft]").click();

    // Lands in the Upcoming track, scheduled — not drafted, not sent. The
    // track's open/closed state persists per BROWSER (localStorage), so a
    // browser that once saw it empty keeps it collapsed — open it like a
    // user would.
    cy.get("[data-cy=upcoming-track]", { timeout: 20_000 }).closest(".qtrack").then(($t) => {
      if ($t.hasClass("qtrack--collapsed")) cy.wrap($t).find(".qtrack__head").click();
    });
    cy.get("[data-cy=upcoming-track] .qcard", { timeout: 20_000 }).first().as("card");
    cy.get("@card").should("contain.text", "Scheduled to send");
    cy.request("/api/invoices").its("body").should((rows: Array<{ status?: string; scheduledFor?: string }>) => {
      expect(rows.some((r) => r.status === "scheduled" && r.scheduledFor === iso(5))).to.eq(true);
    });

    // Change the date from the card back.
    cy.get("@card").find(".qcard__title").scrollIntoView().click();
    cy.get("@card").should("have.class", "qcard--flipped");
    cy.get("@card").find("[data-cy=invoice-change-date]").click();
    cy.get("@card").find("[data-cy=invoice-change-date-input]").clear().type(iso(12));
    cy.get("@card").find("[data-cy=invoice-change-date-save]").click();
    cy.request("/api/invoices").its("body").should((rows: Array<{ status?: string; scheduledFor?: string }>) => {
      expect(rows.some((r) => r.status === "scheduled" && r.scheduledFor === iso(12))).to.eq(true);
    });
  });
});
