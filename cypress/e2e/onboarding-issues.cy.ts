/// <reference types="cypress" />

/**
 * Onboarding — red→green→refactor specs.
 *
 * Every `it` below corresponds to a numbered issue from the manual
 * onboarding audit (see PR for the full doc). They are intentionally
 * RED right now: the system genuinely has the bugs they describe.
 * Fixing each bug should turn exactly one test green; nothing in this
 * spec is meant to assert current behavior.
 *
 * The phone number below is dev-local. Each test wipes it before running
 * so we always exercise the `isNewUser: true` branch of /auth/verify-otp.
 */
describe("Onboarding — red→green→refactor", () => {
  const PHONE = "+18438557777";

  // Walks the conversation up to (but not past) the named step. Step keys
  // mirror the four onboarding asks in ONBOARD_ASK_* on the backend.
  function answer(text: string) {
    cy.get("textarea.composer__input", { timeout: 10_000 })
      .should("be.visible")
      .clear()
      .type(`${text}{enter}`);
    // Wait for the assistant's next bubble to settle before the next answer.
    cy.wait(400);
  }

  beforeEach(() => {
    cy.clearCookies();
  });

  // -------------------------------------------------------------------------
  // Showstoppers
  // -------------------------------------------------------------------------

  it("#1 'See what your customer sees' sample is owned by the just-onboarded business, not 'Dev Business'", () => {
    cy.startFreshOnboarding(PHONE);
    cy.visit("/assistant?onboard=1");
    cy.step("answer name");
    answer("Rafa");
    cy.step("answer business");
    answer("Monster Roofing Co");
    cy.step("answer state");
    answer("Yes, South Carolina");
    cy.step("answer address");
    answer("123 Palm Ave, Charleston, SC 29401");

    cy.step("click the sample-quote link");
    cy.contains("a, button", /see what your customer sees/i, { timeout: 10_000 })
      .should("be.visible")
      .invoke("removeAttr", "target") // force same-tab so we can assert on it
      .click();

    cy.step("assert sample renders the user's business, not Dev Business");
    cy.contains(/monster roofing co/i, { timeout: 10_000 }).should("be.visible");
    cy.contains(/dev business/i).should("not.exist");
    cy.contains(/dev user/i).should("not.exist");
  });

  it("#2 onboarding asks for an email address somewhere in the script", () => {
    cy.startFreshOnboarding(PHONE);
    cy.visit("/assistant?onboard=1");
    answer("Rafa");
    answer("Monster Roofing Co");
    answer("Yes, South Carolina");
    answer("123 Palm Ave, Charleston, SC 29401");
    // At some point during onboarding an email question must appear.
    cy.contains(/email|e-mail|@/i, { timeout: 10_000 }).should("be.visible");
    // And the answer should persist on the user record.
    answer("rafa@monsterroofingco.com");
    cy.request("/api/me").its("body.email").should("eq", "rafa@monsterroofingco.com");
  });

  it("#3 dev master OTP (000000) returns isNewUser=true for a never-seen phone and does NOT seed 'Dev User / Dev Business'", () => {
    // Wipe via the same helper, then verify with the master code.
    cy.exec(`cd ../backend && deno run -A --unstable-kv scripts/dev-wipe-user.ts ${PHONE}`);
    cy.request("POST", "/api/auth/verify", { phoneNumber: PHONE, code: "000000" })
      .then((res) => {
        expect(res.body.ok).to.eq(true);
        expect(res.body.isNewUser, "fresh phone via master OTP must be flagged new").to.eq(true);
        expect(res.body.redirectTo, "fresh phone must route to onboarding").to.match(/onboard=1/);
      });
    cy.request("/api/me").then((res) => {
      expect(res.body.name ?? "", "name must not be auto-seeded").to.not.match(/^dev user$/i);
    });
    cy.request("/api/profile/identity").then((res) => {
      const biz = (res.body?.businessName ?? "").toString();
      expect(biz, "businessName must not be auto-seeded").to.not.match(/^dev business$/i);
    });
  });

  it("#4 Settings page renders the full mailing address including street + postal", () => {
    cy.startFreshOnboarding(PHONE);
    cy.visit("/assistant?onboard=1");
    answer("Rafa");
    answer("Monster Roofing Co");
    answer("Yes, South Carolina");
    answer("123 Palm Ave, Charleston, SC 29401");

    cy.step("verify settings shows street + postal, not just city/state");
    cy.visit("/settings");
    cy.contains("main", "123 Palm Ave").should("be.visible");
    cy.contains("main", "29401").should("be.visible");
  });

  // -------------------------------------------------------------------------
  // Major
  // -------------------------------------------------------------------------

  it("#5 composer placeholder is contextual during onboarding (not the slab example)", () => {
    cy.startFreshOnboarding(PHONE);
    cy.visit("/assistant?onboard=1");
    cy.get("textarea.composer__input", { timeout: 10_000 })
      .should("be.visible")
      .invoke("attr", "placeholder")
      .should((p) => {
        // The job-mode example must not appear during the name step.
        expect(p ?? "").to.not.match(/slab|what should i charge/i);
      });
  });

  it("#6 OTP input auto-splits a 6-digit paste across all 6 boxes", () => {
    cy.exec(`cd ../backend && deno run -A --unstable-kv scripts/dev-wipe-user.ts ${PHONE}`);
    cy.request("POST", "/api/auth/send-otp", { phoneNumber: PHONE });
    cy.visit(`/verify?phone=${encodeURIComponent(PHONE)}`);
    cy.step("paste 6 digits into Digit 1");
    cy.get('input[aria-label="Digit 1"]').type("123456");
    cy.step("each digit landed in its own box");
    cy.get('input[aria-label="Digit 1"]').should("have.value", "1");
    cy.get('input[aria-label="Digit 2"]').should("have.value", "2");
    cy.get('input[aria-label="Digit 3"]').should("have.value", "3");
    cy.get('input[aria-label="Digit 4"]').should("have.value", "4");
    cy.get('input[aria-label="Digit 5"]').should("have.value", "5");
    cy.get('input[aria-label="Digit 6"]').should("have.value", "6");
  });

  it("#7 Settings page exposes edit controls for the business identity", () => {
    cy.startFreshOnboarding(PHONE);
    cy.visit("/settings");
    // At least one real <input>/<textarea>/edit button — not just a static
    // "ask the monsters" hint.
    cy.get("main").within(() => {
      cy.get('input:not([type="hidden"]), textarea, button[aria-label*="edit" i], [contenteditable="true"]')
        .should("have.length.greaterThan", 0);
    });
  });

  it("#8 Onboarding asks for at least one payment method (Venmo/Zelle/ACH/Cash App/Check)", () => {
    cy.startFreshOnboarding(PHONE);
    cy.visit("/assistant?onboard=1");
    answer("Rafa");
    answer("Monster Roofing Co");
    answer("Yes, South Carolina");
    answer("123 Palm Ave, Charleston, SC 29401");
    cy.contains(/venmo|zelle|cash ?app|ach|check|how (do|will) (you|i) get paid|payment method/i, {
      timeout: 10_000,
    }).should("be.visible");
  });

  it("#9 brand reads singular 'Paperwork Monster' on landing + verify (no 'Monsters' plural)", () => {
    cy.visit("/");
    cy.get("header, body").first().within(() => {
      cy.contains(/Paperwork\s+Monsters\b/).should("not.exist");
    });
    cy.exec(`cd ../backend && deno run -A --unstable-kv scripts/dev-wipe-user.ts ${PHONE}`);
    cy.request("POST", "/api/auth/send-otp", { phoneNumber: PHONE });
    cy.visit(`/verify?phone=${encodeURIComponent(PHONE)}`);
    cy.contains(/Paperwork\s+Monsters\b/).should("not.exist");
  });

  // -------------------------------------------------------------------------
  // Smaller
  // -------------------------------------------------------------------------

  it("#10 state step offers a tap-to-confirm button pair, not free text only", () => {
    cy.startFreshOnboarding(PHONE);
    cy.visit("/assistant?onboard=1");
    answer("Rafa");
    answer("Monster Roofing Co");
    cy.step("state step renders quick-confirm buttons");
    cy.contains("button", /yes|sounds right|south carolina/i, { timeout: 10_000 }).should("be.visible");
    cy.contains("button", /different state|not in|pick a state/i).should("be.visible");
  });

  it("#11 address step shows a visible Skip button (not just 'say skip' text)", () => {
    cy.startFreshOnboarding(PHONE);
    cy.visit("/assistant?onboard=1");
    answer("Rafa");
    answer("Monster Roofing Co");
    answer("Yes, South Carolina");
    cy.step("Skip control is a real button at the address step");
    cy.contains("button", /^skip$|solo.*skip/i, { timeout: 10_000 }).should("be.visible");
  });

  it("#13 Settings has a logo upload control", () => {
    cy.startFreshOnboarding(PHONE);
    cy.visit("/settings");
    cy.get('input[type="file"], button:has-text("Upload"), [aria-label*="logo" i]', {
      timeout: 10_000,
    }).should("have.length.greaterThan", 0);
  });

  it("#14 Onboarding offers a 'Skip setup' escape", () => {
    cy.startFreshOnboarding(PHONE);
    cy.visit("/assistant?onboard=1");
    cy.contains(/skip setup|take me to.*dashboard|do this later/i, { timeout: 10_000 })
      .should("be.visible");
  });

  it("#15 Onboarding renders a real progressbar element, not just a fraction", () => {
    cy.startFreshOnboarding(PHONE);
    cy.visit("/assistant?onboard=1");
    cy.get('[role="progressbar"]', { timeout: 10_000 }).should("be.visible");
  });

  it("#16 Dashboard renders a setup checklist after onboarding", () => {
    cy.startFreshOnboarding(PHONE);
    cy.visit("/assistant?onboard=1");
    answer("Rafa");
    answer("Monster Roofing Co");
    answer("Yes, South Carolina");
    answer("123 Palm Ave, Charleston, SC 29401");
    cy.visit("/dashboard");
    cy.contains(/get set up|setup checklist|finish setting up|next steps/i, { timeout: 10_000 })
      .should("be.visible");
  });
});
