/// <reference types="cypress" />

/**
 * RED (TDD) — UX-33 [OTP] "The send-cooldown surfaces as a generic failure
 * that invites retrying. Second submit within 30s shows 'No pudimos enviar el
 * código. Intenta otra vez.' — the retry keeps failing for 30s while a valid
 * code sits in the user's SMS. On 429 the form should route to /verify
 * ('Ya te enviamos un código — revísalo') or show the countdown from the
 * response's retryAfterSeconds."
 *
 * The API half is already live (curl 2026-08-19): a cooldown-hit
 * POST /api/auth/send-otp answers
 *   429 {"ok":false,"error":"cooldown","retryAfterSeconds":26}   (live count)
 * The bug is pure FE: front-end/static/landing-scripts.js:827-853 does
 * `if (!res.ok) throw` and its catch paints the ONE generic error
 * (copy("cta.errSend") — landing-dict.ts:307 "No pudimos enviar el código.
 * Intenta otra vez.") into #cf-meta for every non-ok status, 429 included.
 *
 * Selector grounding (all read from source):
 *   - front-end/routes/index.tsx:1076-1163 — the "/" signup form:
 *     #contact-form, #f-phone (phone input), button.cf-cta (submit),
 *     #cf-meta (the role="alert" error line).
 *   - front-end/static/landing-scripts.js:788-801 — showError paints #cf-meta.
 *   - front-end/routes/verify.tsx:19-101 — /verify renders "Te enviamos un
 *     código a <phone>" (STRINGS[lang]["verify.lede"]), i.e. landing there IS
 *     the "already sent" reassurance the finding asks for.
 *
 * Phones: +15125556010 ONLY (this slice's cypress cooldown phone).
 */

const PHONE = "+15125556010";
const PHONE_DIGITS = "5125556010";
const GENERIC_ES = /no pudimos enviar/i;
/** Countdown / already-sent shapes the fixed form may show while staying on
 *  the landing page (finding: "Ya te enviamos un código — revísalo" or a
 *  countdown from retryAfterSeconds). */
const COOLDOWN_COPY_ES = /(ya te enviamos|ya enviamos|rev[ií]sa|espera|\d{1,3}\s*(s\b|seg))/i;

/** Arm the 30s cooldown for PHONE, then submit the "/" signup form for the
 *  same phone (the cooldown-hit send). Intercepts the send as @sendOtp. */
function submitOnCooldown() {
  // First send via API — 200 arms the cooldown; 429 means it is already
  // armed from a run <30s ago. Either way the form submit below is a
  // cooldown-hit.
  cy.request({
    method: "POST",
    url: "/api/auth/send-otp",
    body: { phoneNumber: PHONE, language: "es" },
    failOnStatusCode: false,
  });

  cy.intercept("POST", "/api/auth/send-otp").as("sendOtp");
  cy.visit("/");
  // landing-scripts.js is deferred; the ES nav CTA proves applyLang ran
  // (same readiness gate as landing-mobile-390.cy.ts).
  cy.contains(".nav a", "Empezar");
  cy.get("#f-phone").type(PHONE_DIGITS);
  cy.get("#contact-form button.cf-cta").click();

  // The form's fetch for THIS submit — must be the 429 cooldown hit, else
  // the scenario didn't arm (wrong-reason guard, not the assertion).
  cy.wait("@sendOtp").then((interception) => {
    expect(
      interception.response?.statusCode,
      "precondition: the form submit hit the cooldown (429)",
    ).to.eq(429);
  });

  // Settle: the form either navigated away or painted its alert line.
  cy.get("body", { timeout: 10_000 }).should(($b) => {
    const doc = $b[0].ownerDocument;
    const navigated = doc.location.pathname !== "/";
    const meta = doc.getElementById("cf-meta");
    const alerted = Boolean(meta && (meta.textContent ?? "").trim().length > 0);
    expect(
      navigated || alerted,
      "the form responded visibly to the 429",
    ).to.eq(true);
  });
}

describe("UX-33: OTP cooldown on the landing signup form", () => {
  beforeEach(() => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "es");
    cy.viewport(390, 844);
  });

  it("UX-33: a cooldown-hit submit routes to /verify or shows an already-sent countdown — never a dead-end failure", () => {
    submitOnCooldown();

    cy.location().then((loc) => {
      if (loc.pathname.startsWith("/verify")) {
        // Desired option A — hand the user to the code screen; /verify's own
        // lede ("Te enviamos un código a …", verify.tsx:89-92) reassures
        // them the code is already in their SMS.
        expect(loc.search, "/verify carries the phone").to.match(/phone=/);
      } else {
        // Desired option B — stay on the form but tell the truth: the code
        // was ALREADY sent; show the countdown from retryAfterSeconds.
        // RED today: #cf-meta reads "No pudimos enviar el código. Intenta
        // otra vez." (landing-scripts.js:847-851).
        cy.get("#cf-meta")
          .invoke("text")
          .then((text) => {
            expect(text, "cooldown is not presented as a send failure").not.to
              .match(GENERIC_ES);
            expect(
              text,
              "the message reassures the code was already sent / counts down",
            ).to.match(COOLDOWN_COPY_ES);
          });
      }
    });
  });

  it('UX-33: the generic "No pudimos enviar el código. Intenta otra vez." never appears for a cooldown-hit send', () => {
    submitOnCooldown();

    cy.location("pathname").then((pathname) => {
      if (pathname !== "/") return; // routed away — nothing generic shown
      // RED today: this is exactly the copy painted into #cf-meta.
      cy.get("#cf-meta").invoke("text").should((text) => {
        expect(text).not.to.match(GENERIC_ES);
      });
    });
  });
});

export {};
