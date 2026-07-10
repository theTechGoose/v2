/// <reference types="cypress" />

/**
 * Onboarding — audit reconciliation.
 *
 * This spec started as a red-by-design audit of the OLD chat-driven
 * onboarding. New users now go to the first-sign-in wizard at /welcome
 * (see routes/welcome.tsx + islands/WelcomeWizard.tsx), so the chat-walk
 * issues below have moved to `onboarding-wizard.cy.ts`:
 *
 *   #1  sample-quote branding        → onboarding-wizard "sample quote is branded…"
 *   #2  onboarding asks for email    → onboarding-wizard "blocks Continue on an invalid email…"
 *   #4  full mailing address         → onboarding-wizard "answers every question…" (street + zip)
 *   #8  asks for a payment method    → onboarding-wizard "payment merge keeps a method…"
 *   #10 tap-to-confirm state         → onboarding-wizard "answers every question…" (Yes, South Carolina)
 *   #11 visible Skip control         → onboarding-wizard skippable steps (Skip button)
 *   #14 skip-setup escape            → onboarding-wizard "'Skip setup for now' lands on the dashboard…"
 *   #15 real progressbar             → onboarding-wizard "renders a real progressbar…"
 *   #16 dashboard setup checklist    → onboarding-wizard "skipping everything leaves the SetupChecklist…"
 *
 *   #5  contextual chat placeholder  → RETIRED. New users no longer enter the
 *       chat onboarding state machine at all (they go to /welcome), so the
 *       composer-placeholder-during-onboarding case no longer applies to them.
 *       The chat state machine remains only as a backstop for existing
 *       half-onboarded users and is exercised by the assistant specs.
 *   #7  Settings edit controls       → covered by the settings-* spec group
 *       (run:settings); it's a Settings-surface concern, not onboarding.
 *   #13 Settings logo upload         → covered by the settings-* spec group.
 *
 * What stays here is genuinely flow-adjacent and now asserts the NEW behavior:
 * the post-verify redirect target (#3 → /welcome), the OTP paste widget (#6),
 * and the singular brand copy on landing + verify (#9).
 */
describe("Onboarding — reconciled audit", () => {
  const PHONE = "+18438557777";

  beforeEach(() => {
    cy.clearCookies();
    // App is Spanish-first now; these specs assert English copy. Re-pin EN
    // (the support beforeEach set it, but our clearCookies above wiped it).
    cy.setCookie("pm_lang", "en");
  });

  it("#3 dev master OTP (000000) returns isNewUser=true and routes a fresh phone to /welcome (no 'Dev User / Dev Business' seed)", () => {
    cy.exec(`cd ../backend && deno run -A --unstable-kv scripts/dev-wipe-user.ts ${PHONE}`);
    cy.request("POST", "/api/auth/verify", { phoneNumber: PHONE, code: "000000" })
      .then((res) => {
        expect(res.body.ok).to.eq(true);
        expect(res.body.isNewUser, "fresh phone via master OTP must be flagged new").to.eq(true);
        expect(res.body.redirectTo, "fresh phone must route to the first-sign-in wizard").to.eq("/welcome");
      });
    cy.request("/api/me").then((res) => {
      expect(res.body.name ?? "", "name must not be auto-seeded").to.not.match(/^dev user$/i);
    });
    cy.request("/api/profile/identity").then((res) => {
      const biz = (res.body?.businessName ?? "").toString();
      expect(biz, "businessName must not be auto-seeded").to.not.match(/^dev business$/i);
    });
  });

  it("#6 OTP input auto-splits a 6-digit paste across all 6 boxes", () => {
    cy.exec(`cd ../backend && deno run -A --unstable-kv scripts/dev-wipe-user.ts ${PHONE}`);
    cy.request("POST", "/api/auth/send-otp", { phoneNumber: PHONE });
    cy.visit(`/verify?phone=${encodeURIComponent(PHONE)}`);
    cy.step("paste 6 digits into Digit 1 (a real paste event, not per-char typing)");
    cy.get('input[aria-label="Digit 1"]').trigger("paste", {
      clipboardData: { getData: () => "123456" },
    });
    cy.step("each digit landed in its own box");
    cy.get('input[aria-label="Digit 1"]').should("have.value", "1");
    cy.get('input[aria-label="Digit 2"]').should("have.value", "2");
    cy.get('input[aria-label="Digit 3"]').should("have.value", "3");
    cy.get('input[aria-label="Digit 4"]').should("have.value", "4");
    cy.get('input[aria-label="Digit 5"]').should("have.value", "5");
    cy.get('input[aria-label="Digit 6"]').should("have.value", "6");
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
});
