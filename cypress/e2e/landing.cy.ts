/// <reference types="cypress" />

/**
 * Landing → verify → logged-in. Exercises the real UI sign-in path
 * end-to-end using the dev master OTP (000000), which the verify-otp
 * coordinator accepts when not running on Deno Deploy.
 *
 *   1. /              type phone into the contact form, submit
 *   2. /verify?phone= fill the 6 OTP digits with 0, click Verify
 *   3. /dashboard or /assistant — backend set pm_session cookie
 */
describe("landing — sign in with master OTP", () => {
  const PHONE_DIGITS = "5125550199";
  const PHONE_E164 = `+1${PHONE_DIGITS}`;

  beforeEach(() => {
    cy.clearCookies();
  });

  it("logs in via the landing form + master OTP and lands on the app", () => {
    cy.visit("/");

    // Phone capture on landing.
    cy.get("#f-phone", { timeout: 10_000 })
      .should("be.visible")
      .type(PHONE_DIGITS);
    cy.get("#contact-form button.cf-cta.submit").click();

    // Landing JS POSTs send-otp then redirects to /verify.
    cy.location("pathname", { timeout: 10_000 }).should("eq", "/verify");
    cy.location("search").should("include", encodeURIComponent(PHONE_E164));

    // Fire one paste event with "000000" — the CodeInput onPaste handler
    // fills all 6 slots and auto-submits, which avoids the focus/auto-
    // advance race that a per-slot type() chain triggers (and that the
    // 6th keystroke's auto-submit makes flaky).
    cy.get(".code-input")
      .should("be.visible")
      .trigger("paste", {
        clipboardData: { getData: () => "000000" },
      });

    // CodeInput delays the redirect 400ms for the step animation.
    cy.location("pathname", { timeout: 10_000 })
      .should("match", /^\/(dashboard|assistant)$/);

    // Session cookie should now be set.
    cy.getCookie("pm_session").should("exist");
  });
});
