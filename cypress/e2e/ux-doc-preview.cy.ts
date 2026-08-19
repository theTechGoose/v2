/// <reference types="cypress" />

/**
 * UX audit (ux-problems.md) — UX-15 e2e half.
 *
 * UX-15 [DOCS] "Raw unformatted phones on the document preview. De-block shows
 *   '+1512555…' raw E.164, Para-block bare 10 digits, while the rest of the
 *   app formats '(512) 555-….' One formatter everywhere
 *   (shared/quote-flow/format-helpers exists)." (Audit's example digits
 *   elided — this spec uses only slice-F block numbers.)
 *
 * Where the raw strings actually render (read from source — this decided the
 * surface): the PUBLIC documents already format phones — /c and /i via
 * PartyCard → fmtPhone (front-end/components/doc-parts.tsx:214-222), the /q
 * footer via fmtPhone (front-end/routes/q/[id].tsx:365-371). The offender is
 * the ASSISTANT'S document preview (the "Mira lo que ve tu cliente" review
 * card, island AsstChat):
 *   front-end/islands/AsstChat.tsx:5197  De block   <span>{from.phone}</span>
 *     — raw E.164 from the route prop (front-end/routes/assistant/
 *     [threadId].tsx:148-153: phone: user?.phoneNumber)
 *   front-end/islands/AsstChat.tsx:5308  Para block {customer.phoneNumber ?? ""}
 *     — raw stored customer phone
 * Both live inside .quote-review__hero-meta; the fix is to route them through
 * shared/quote-flow/format-helpers.ts:66 formatPhoneDisplay (unit contract-pin
 * in jest/unit/ux-page-copy.test.ts).
 *
 * Deterministic drive (prior art assistant-experience.cy.ts P-26/P-21 —
 * the assistant preview IS drivable): /assistant?dev → .chat__empty-debug-btn
 * (dev seedPhase2, no LLM) → customer create form (name + phone + email) →
 * 4× first wizard option → .quote-review.
 *
 * Phones (slice F block): contractor +15125556550 (the login phone becomes
 * the De-block phone), customer typed into the form as bare 10-digit
 * 5125556551 (mirrors the audit's Para-block shape).
 */

const PHONE = "+15125556550";
const CUSTOMER_PHONE_RAW = "5125556551";

function pickFirstOption() {
  cy.get(".wiz__opts .wiz-opt:not(.wiz-opt--custom)", { timeout: 15_000 })
    .filter(":visible")
    .first()
    .click();
}

describe("UX-15: the doc preview De/Para blocks render formatted phones", () => {
  beforeEach(() => {
    cy.clearCookies();
    cy.loginAs(PHONE);
    cy.request({ url: "/api/me/wipe", failOnStatusCode: false });
    cy.loginAs(PHONE);
    cy.request("POST", "/api/me/onboarded", { skipped: true });
    cy.apiUpdateUser({ language: "es" });
    cy.clearCookie("pm_lang");

    cy.visit("/assistant?dev");
    cy.get(".chat__empty-debug-btn", { timeout: 10_000 })
      .should("be.visible")
      .click();
    cy.location("pathname", { timeout: 20_000 })
      .should("match", /^\/assistant\/[A-Za-z0-9_-]+$/);
    // Customer step — type the phone exactly as a contractor would (bare 10
    // digits), plus an email so the send affordances stay enabled.
    cy.openCustomerCreateForm();
    cy.get(".cust-create input.cust-pick__search", { timeout: 20_000 })
      .first()
      .type("María Nguyen");
    cy.get(".cust-create input[type=tel]").type(CUSTOMER_PHONE_RAW);
    cy.get(".cust-create input[type=email]").type(
      "maria.ux15@blackhole.postmarkapp.com",
    );
    cy.get(".cust-create__btn--primary").should("not.be.disabled").click();
    pickFirstOption();
    pickFirstOption();
    pickFirstOption();
    pickFirstOption();
    cy.get(".quote-review", { timeout: 20_000 }).should("be.visible");
  });

  it("UX-15: no raw phone digits render in the De/Para hero blocks", () => {
    // RED today: the De block prints the contractor phone verbatim
    // ("+15125556550", AsstChat.tsx:5197) and the Para block the stored
    // customer phone (AsstChat.tsx:5308). A formatted display
    // ("+1 (512) 555-6550") contains no 10+ digit run, so this rejects
    // exactly the raw forms.
    cy.get(".quote-review__hero-meta").each(($meta) => {
      const text = $meta.text();
      expect(text, `hero meta ("${text.trim()}") has no raw E.164 phone`).to
        .not.match(/\+1\d{10}/);
      expect(
        text,
        `hero meta ("${text.trim()}") has no bare 10-digit phone run`,
      ).to.not.match(/(?<!\d)\d{10}(?!\d)/);
    });
  });

  it("UX-15: the De block shows the contractor phone grouped as (512) 555-…", () => {
    // The De (FROM) hero is the read-only section rendered before the
    // customer hero (AsstChat.tsx:5177-5212).
    cy.get(".quote-review__hero").first().find(".quote-review__hero-meta")
      .invoke("text")
      .then((raw) => {
        const text = String(raw);
        // RED today: raw "+15125556550".
        expect(text, "De-block phone is display-formatted").to.contain(
          "(512) 555-6550",
        );
      });
  });

  it("UX-15: the Para block shows the customer phone grouped as (512) 555-…", () => {
    cy.get(".quote-review__hero").eq(1).find(".quote-review__hero-meta")
      .invoke("text")
      .then((raw) => {
        const text = String(raw);
        // RED today: raw "5125556551" (or its normalized E.164 twin).
        expect(text, "Para-block phone is display-formatted").to.contain(
          "(512) 555-6551",
        );
      });
  });
});

// Module scope: keeps top-level declarations out of the shared global
// script scope the spec files otherwise compile into.
export {};
