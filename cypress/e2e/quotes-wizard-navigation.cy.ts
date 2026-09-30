/// <reference types="cypress" />

/**
 * Wizard step navigation — SINGLE back button contract (2026-08-19).
 *
 * Supersedes the old roadmap p2/p8 per-step [data-cy=wizard-back] controls:
 * the assistant now renders exactly ONE back control, the chat header's
 * a.chat__head-btn, and it UNDOES the previous action via the shared
 * resolver (shared/quote-flow/assistant-back.ts). The BEHAVIOR the roadmap
 * wanted is unchanged and asserted here:
 *  - earlier answers stay editable: backing into Job Details restores the
 *    typed content (p2), and edits flow into the regenerated quote;
 *  - the "Who is this for?" step collects a Business Name (p7);
 *  - at the terminal (invoice-produced) stage back exits to /dashboard (p3).
 */
describe("quote wizard — back navigation through the steps", () => {
  const PHONE = "+15125550921";

  beforeEach(() => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "en"); // re-pin EN after the wipe (Spanish-first app)
    cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "en" }); // fresh users default to es; EN copy asserted
    cy.request("POST", "/api/me/onboarded", { skipped: true }); // skip the /welcome trap for fresh users
    cy.visit("/assistant");
    cy.contains("button.chat__empty-prompt", "I know my price, write it up.").click();
    cy.contains(".chat__details-prompt-bubble", /tell me the job details/i)
      .should("be.visible");
  });

  function submitDetails(text: string) {
    cy.get("textarea.composer__input").should("be.visible").type(text);
    cy.get("button.composer__send").click();
  }

  it("steps render NO in-widget back control — the header back is the single one", () => {
    submitDetails("Remove old toilet, install new toilet, test for leaks");
    cy.get(".chat__price-capture", { timeout: 10_000 }).should("be.visible");

    cy.get("[data-cy=wizard-back]").should("not.exist");
    cy.get("a.chat__head-btn").should("have.length", 1).and("be.visible");
  });

  it("going back to Job Details restores the typed content for editing (p2)", () => {
    const details = "Remove old toilet, install new toilet, test for leaks";
    submitDetails(details);
    cy.get(".chat__price-capture", { timeout: 10_000 }).should("be.visible");

    cy.get("a.chat__head-btn").click();

    // The job-details step is back AND still holds what was typed — editable,
    // not blanked.
    cy.get("textarea.composer__input")
      .should("be.visible")
      .invoke("val")
      .should("contain", "Remove old toilet");
  });

  it("edits made after going back flow into the regenerated quote", () => {
    submitDetails("Remove old toilet, install new toilet");
    cy.get(".chat__price-capture", { timeout: 10_000 }).should("be.visible");

    cy.get("a.chat__head-btn").click();
    cy.get("textarea.composer__input").should("be.visible")
      .type(", also test for leaks");
    cy.get("button.composer__send").click();

    cy.get(".chat__price-capture", { timeout: 10_000 }).should("be.visible");
    cy.contains(/test for leaks/i).should("exist");
  });

  it("the 'Who is this for?' step collects a Business Name (p7)", () => {
    submitDetails("Remove old toilet, install new toilet, test for leaks");
    cy.get(".chat__price-capture", { timeout: 10_000 }).should("be.visible");
    // Enter a price to advance to the customer step.
    cy.get(".chat__price-capture input").first().type("500{enter}");

    cy.contains(/who is this for/i, { timeout: 10_000 }).should("be.visible");
    cy.get("[data-cy=wizard-business-name]").should("be.visible");

    // It is optional: leaving it empty must not block Next.
    cy.get("[data-cy=wizard-business-name]").should("not.have.attr", "required");
  });

  it("at the invoice stage the universal back exits to the Dashboard, not into the finished flow (p3)", () => {
    // Drive the flow far enough that the conversation reaches its terminal
    // (invoice-produced) stage, then press the assistant's universal back.
    // The contract (AsstChat pm:asst-back): once the flow is terminal there
    // is nothing left to rewind or pop → back leaves for /dashboard.
    submitDetails("Remove old toilet, install new toilet, test for leaks");
    cy.get(".chat__price-capture", { timeout: 10_000 }).should("be.visible");
    cy.get(".chat__price-capture input").first().type("500{enter}");
    cy.contains(/who is this for/i, { timeout: 10_000 }).should("be.visible");

    // Mark the conversation terminal via the API seam the UI uses, then
    // reload the same conversation view.
    cy.location("search").then(() => {
      cy.request("/api/agents/conversations").then(({ body }) => {
        const conv = (Array.isArray(body) ? body : body.items ?? [])[0];
        expect(conv, "active conversation").to.exist;
        cy.request({
          method: "POST",
          url: `/api/agents/conversations/${conv.id}/send-invoice`,
          failOnStatusCode: false,
        });
        cy.visit(`/assistant?c=${conv.id}`);
      });
    });

    cy.get("a.chat__head-btn").should("be.visible").click();
    cy.location("pathname").should("eq", "/dashboard");
  });
});

// ===========================================================================
// REQ-009 — NW-23 (p22): "'When does the job start?' has a 'Job Completed'
// option. Remove it and put 'Pick a date' in its place. Change 'Next Month'
// to 'Next month'."
// ===========================================================================
describe("REQ-009 NW-23 the start-date step offers exactly four options (+ TBD, REQ-046)", () => {
  const PHONE = "+15125550927";

  beforeEach(() => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "en");
    cy.loginAs(PHONE);
    cy.request({ url: "/api/me/wipe", failOnStatusCode: false });
    cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "en" });
    cy.request("POST", "/api/me/onboarded", { skipped: true });
    cy.setCookie("pm_lang", "en");
    cy.visit("/assistant");
    cy.contains("button.chat__empty-prompt", "I know my price, write it up.").click();
    cy.get("textarea.composer__input").should("be.visible")
      .type("Remove old toilet, install new toilet, test for leaks");
    cy.get("button.composer__send").click();
    cy.get(".chat__price-capture", { timeout: 10_000 }).should("be.visible");
    cy.get(".chat__price-capture input").first().type("500{enter}");
    cy.location("pathname", { timeout: 20_000 }).should("match", /^\/assistant\/.+/);
    // Wiped account → the customer step opens on the create form.
    cy.get(".cust-create input.cust-pick__search", { timeout: 20_000 })
      .first()
      .type("Start Date Customer");
    cy.get(".cust-create input[type=tel]").type("5125550928");
    cy.get(".cust-create__btn--primary").should("not.be.disabled").click();
    cy.contains(/when does the job start/i, { timeout: 20_000 }).should("be.visible");
  });

  it("REQ-009 NW-23 Right away / Next week / Next month / Pick a date — and no 'Job Completed'", () => {
    cy.get(".wiz__opts .wiz-opt").filter(":visible").then(($opts) => {
      const texts = [...$opts].map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim());
      // REQ-046 (2026-09-30): "add TBD to when does the job start" — TBD sits
      // before "Pick a date", which stays the last option.
      expect(texts, "start-date options").to.deep.equal([
        "Right away",
        "Next week",
        "Next month",
        "TBD",
        "Pick a date",
      ]);
    });
    cy.contains("Job Completed").should("not.exist");
    cy.contains("Next Month").should("not.exist");
  });

  // REQ-046 / REQ-047 (2026-09-30), Raphael: "in the wizard we need to add TBD
  // to when does the job start and how long will the job take."
  it("REQ-046 TBD is offered on 'When does the job start?' and lands on the agreement as Start: TBD", () => {
    cy.get(".wiz__opts .wiz-opt").filter(":visible").contains(/^TBD$/).click();
    // The transcript records the pick with the step's label.
    cy.contains(/Start: TBD/, { timeout: 20_000 }).should("be.visible");
    // …and the wizard moves on to the duration step.
    cy.contains(/how long will the job take/i, { timeout: 20_000 }).should("be.visible");
  });

  it("REQ-047 TBD is offered on 'How long will the job take?' and lands on the agreement as Time to complete: TBD, never 'Estimated TBD'", () => {
    cy.get(".wiz__opts .wiz-opt").filter(":visible").contains(/^TBD$/).click();
    cy.contains(/how long will the job take/i, { timeout: 20_000 }).should("be.visible");
    cy.get(".wiz__opts .wiz-opt").filter(":visible").then(($opts) => {
      const texts = [...$opts].map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim());
      expect(texts, "duration options").to.deep.equal([
        "1 day",
        "2–3 days",
        "1 week",
        "2 weeks",
        "Job completed",
        "TBD",
        "Custom",
      ]);
    });
    cy.get(".wiz__opts .wiz-opt").filter(":visible").contains(/^TBD$/).click();
    cy.contains(/Time to complete: TBD/, { timeout: 20_000 }).should("be.visible");
    // Finish the wizard so the terms land on the quote, then check the
    // customer-facing agreement: both rows say TBD, and the duration row is
    // NOT wrapped as an estimate.
    cy.contains(/how would you like to be paid|payment/i, { timeout: 20_000 }).should("be.visible");
    cy.get(".wiz__opts .wiz-opt").filter(":visible").first().click();
    cy.contains(/warranty|stand behind your work/i, { timeout: 20_000 }).should("be.visible");
    cy.get(".wiz__opts .wiz-opt").filter(":visible").first().click();
    cy.location("pathname").then((path) => {
      const conversationId = path.split("/").pop()!;
      cy.request(`/api/agents/conversations/${conversationId}`).then(({ body }) => {
        const quoteId: string = body?.conversation?.quoteId ?? body?.quoteId;
        expect(quoteId, "conversation quoteId").to.be.a("string");
        cy.request(`/api/quotes/${quoteId}`).then(({ body: q }) => {
          const byStep = Object.fromEntries((q.terms ?? []).map((t: { stepId: string; value: string }) => [t.stepId, t.value]));
          expect(byStep.start_date, "stored start term").to.eq("TBD");
          expect(byStep.wraps, "stored duration term").to.eq("TBD");
        });
        cy.visit(`/q/${quoteId}?lang=en`);
        cy.get(".ctr__terms-grid", { timeout: 20_000 }).should("be.visible").invoke("text").then((text) => {
          const flat = String(text).replace(/\s+/g, " ");
          expect(flat, "agreement term grid").to.match(/Start date\s*TBD/);
          expect(flat, "agreement term grid").to.match(/Time to complete\s*TBD/);
          expect(flat, "agreement term grid").to.not.match(/Estimated TBD/);
        });
      });
    });
  });
});
