/// <reference types="cypress" />

/**
 * Signup-funnel gaps — FAILING (RED) specs pinning desired behavior.
 *
 * P-54: "Wizard step 4 (state) is the only step with no Atrás/Omitir buttons."
 * P-39: "'¿Número incorrecto? Editar' on /verify links to `/` — dropping a
 *        `/landing`-originated user onto the _other_ landing with no scroll
 *        target to the phone form."
 * P-38: "Address autocomplete ignores the state confirmed 10 seconds earlier.
 *        After 'Sí, Texas', typing '1600 Congress' returns
 *        Chicago/Ypsilanti/Indianapolis/Cincinnati — zero Texas."
 *
 * Phones: +15125552093-2096 (512 area code → suggestedState "TX" via
 * backend/src/core/business/us-states/mod.ts). Reserved block, disjoint from
 * the jest otp-rate-limit phones (+15125552000-2092).
 *
 * Copy is asserted in EN: cy.startFreshOnboarding seeds language "en"
 * (support/commands.ts), and lang/en.json has welcome.back="Back",
 * welcome.skip="Skip", welcome.state.confirm="Yes, {stateName}",
 * welcome.state.pickAnother="Pick a different state",
 * welcome.address.street="Street address". The /verify edit link lives in
 * front-end/lib/lang.ts STRINGS: EN "Wrong number? Edit" /
 * ES "¿Número incorrecto? Editar" (islands/CodeInput.tsx renders it).
 */

/** Seed steps 1-3 (name, business name, email) via the profile API so
 *  /welcome resumes exactly on the state step (step 4) — same pattern as
 *  onboarding-wizard.cy.ts "resumes at the state step". */
function seedThroughEmail() {
  cy.request("PUT", "/api/me", { name: "Rafa", email: "rafa@x.com" });
  cy.request("PUT", "/api/profile/identity", { businessName: "Monster Co" });
}

describe("P-54: wizard step 4 (state) must offer Back and Skip like every other step", () => {
  beforeEach(() => {
    cy.clearCookies();
  });

  it("P-54: the state step's tap-to-confirm view (Yes, Texas) also renders Back and Skip", () => {
    cy.startFreshOnboarding("+15125552093");
    seedThroughEmail();
    cy.visit("/welcome");

    cy.step("resumed on step 4 (state) with the area-code guess banner");
    cy.get('[role="progressbar"]', { timeout: 10_000 })
      .should("have.attr", "aria-valuenow", "4");
    cy.contains("button", /^yes, texas$/i, { timeout: 10_000 })
      .should("be.visible");

    cy.step("desired: Back + Skip exist on this step like on every other");
    // RED today: WelcomeWizard.tsx renders NO StepFooter at all in banner
    // mode (StateStep returns null instead of the footer), and the state
    // registry entry is skippable:false, so neither button can appear.
    // welcome.skipSetup is "Skip setup for now" — the ^…$ anchors keep the
    // bare "Skip"/"Back" matches from colliding with it.
    cy.contains("button", /^back$/i).should("be.visible");
    cy.contains("button", /^skip$/i).should("be.visible");
  });

  it("P-54: Skip is still offered after opening the full state picker", () => {
    cy.startFreshOnboarding("+15125552094");
    seedThroughEmail();
    cy.visit("/welcome");

    cy.contains("button", /^pick a different state$/i, { timeout: 10_000 })
      .should("be.visible")
      .click();

    cy.step("picker grid open — footer must include Skip, not just Back/Continue");
    cy.get(".welcome__chip-grid", { timeout: 10_000 }).should("be.visible");
    cy.contains("button", /^back$/i).should("be.visible");
    // RED today: buildSteps() marks the state step skippable:false, so the
    // footer renders Back + Continue but never Skip.
    cy.contains("button", /^skip$/i).should("be.visible");
  });
});

describe("P-39: /verify's edit-phone link must return the user to the form they came from", () => {
  it("P-39: a /landing signup who clicks 'Wrong number? Edit' lands back on /landing's phone form, not bare /", () => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "en"); // deterministic copy (Spanish-first app)
    // Clear any prior OTP/cooldown state for this phone (same wipe script
    // startFreshOnboarding uses) so the landing form's real send-otp POST
    // succeeds even once P-03's 30s cooldown exists.
    cy.exec(
      "cd ../backend && deno run -A --unstable-kv scripts/dev-wipe-user.ts +15125552095",
      { failOnNonZeroExit: false, timeout: 30_000 },
    );

    cy.step("start signup from the /landing promo phone form");
    cy.visit("/landing");
    cy.get("#trial-phone", { timeout: 10_000 })
      .should("be.visible")
      .type("5125552095");
    cy.get(".pm-trial-form button[type=submit]").click();
    cy.location("pathname", { timeout: 15_000 }).should("eq", "/verify");

    cy.step("click the edit-phone link");
    cy.contains("a", /wrong number\? edit|¿número incorrecto\? editar/i, {
      timeout: 10_000,
    })
      .should("be.visible")
      .click();

    cy.step("desired: back on /landing with the phone form available");
    // RED today: islands/CodeInput.tsx hardcodes <a href="/"> — the click
    // drops a /landing-originated user onto the OTHER landing ("/", the main
    // index page), which has no #trial-phone form to edit the number in.
    cy.location("pathname", { timeout: 10_000 }).should("eq", "/landing");
    cy.get("#trial-phone").should("be.visible");
  });
});

describe("P-38: address autocomplete must honor the state confirmed moments earlier", () => {
  it("P-38: with state=TX confirmed, '1600 Congress' suggests only Texas addresses", () => {
    cy.clearCookies();
    cy.startFreshOnboarding("+15125552096");
    seedThroughEmail();
    // The user already confirmed Texas on the state step ("Sí, Texas") —
    // persist exactly what that tap saves so /welcome resumes on the
    // address step with the confirmed state on record.
    cy.request("PUT", "/api/profile/address", { state: "TX" });

    cy.visit("/welcome");
    cy.step("resumed on step 5 (address)");
    cy.get('[role="progressbar"]', { timeout: 10_000 })
      .should("have.attr", "aria-valuenow", "5");

    cy.step("type the Texas Capitol's street");
    cy.get('input[aria-label="Street address"]', { timeout: 10_000 })
      .should("be.visible")
      .type("1600 Congress");

    cy.step("desired: every real suggestion is in Texas");
    // The dropdown's FIRST option is always the raw typed text
    // (.welcome__ac-opt--custom); the network-backed suggestions are the
    // remaining .welcome__ac-opt buttons. NOTE: there is no backend proxy —
    // front-end/lib/mapbox.ts suggestAddresses() calls the Mapbox geocode API
    // directly from the browser with no state bias/filter, so today this
    // query renders Chicago IL / Ypsilanti MI / Indianapolis IN /
    // Cincinnati OH and ZERO Texas rows (RED). Desired: results are
    // biased/filtered to the user's confirmed state, so at least one TX
    // suggestion appears (1600 Congress Ave, Austin TX exists) and no
    // out-of-state row is shown.
    cy.get(
      ".welcome__ac-list .welcome__ac-opt:not(.welcome__ac-opt--custom) .welcome__ac-text",
      { timeout: 20_000 },
    ).should(($labels) => {
      expect(
        $labels.length,
        "at least one address suggestion for '1600 Congress'",
      ).to.be.greaterThan(0);
      $labels.each((_i, el) => {
        expect(el.textContent?.trim() ?? "", "suggestion is in Texas")
          .to.match(/,\s*TX\b/);
      });
    });
  });
});
