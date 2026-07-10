/// <reference types="cypress" />

/**
 * Onboarding wizard (/welcome) — shell + resume behavior.
 *
 * Covers the Phase 2 contract: the one-question-at-a-time wizard shell, its
 * single-direction redirects (no session → /, already-onboarded → /dashboard),
 * the permanent "Skip setup for now" escape, and profile-data-as-state resume.
 *
 * PHONE is dev-local (843 area code → SC), NOT a hardcoded super-admin, and is
 * wiped before each fresh-onboarding test.
 */
describe("Onboarding wizard — /welcome shell", () => {
  const PHONE = "+18435559001";

  beforeEach(() => {
    cy.clearCookies();
  });

  it("redirects a logged-out visitor to the landing page", () => {
    cy.clearCookies();
    cy.visit("/welcome");
    cy.location("pathname", { timeout: 10_000 }).should("eq", "/");
  });

  it("bounces an already-onboarded user to the dashboard (no re-trap)", () => {
    cy.startFreshOnboarding(PHONE);
    // Mark onboarding done directly, then /welcome must never trap again.
    cy.request("POST", "/api/me/onboarded", { skipped: true })
      .its("status").should("be.oneOf", [200, 201]);
    cy.visit("/welcome");
    cy.location("pathname", { timeout: 10_000 }).should("eq", "/dashboard");
  });

  it("renders a real progressbar + step count for a fresh user", () => {
    cy.startFreshOnboarding(PHONE);
    cy.visit("/welcome");
    cy.get('[role="progressbar"]', { timeout: 10_000 })
      .should("be.visible")
      .and("have.attr", "aria-valuenow", "1");
    cy.contains(/step 1 of/i).should("be.visible");
  });

  it("'Skip setup for now' lands on the dashboard and is permanent", () => {
    cy.startFreshOnboarding(PHONE);
    cy.visit("/welcome");
    cy.contains("button", /skip setup for now/i, { timeout: 10_000 })
      .should("be.visible")
      .click();
    cy.location("pathname", { timeout: 10_000 }).should("eq", "/dashboard");
    // Re-visiting /welcome after skipping must bounce straight to /dashboard.
    cy.visit("/welcome");
    cy.location("pathname", { timeout: 10_000 }).should("eq", "/dashboard");
  });

  it("saves the name and resumes at the NEXT question on reload", () => {
    cy.startFreshOnboarding(PHONE);
    cy.visit("/welcome");

    cy.step("answer the name question");
    cy.get(".welcome__input", { timeout: 10_000 })
      .should("be.visible")
      .clear()
      .type("Rafa");
    cy.contains("button", /^continue$/i).click();

    cy.step("name persisted to the user record");
    cy.request("/api/me").its("body.name").should("eq", "Rafa");

    cy.step("reload /welcome — resume past the name step");
    cy.visit("/welcome");
    cy.get('[role="progressbar"]', { timeout: 10_000 })
      .should("have.attr", "aria-valuenow", "2");
    cy.contains(/what's your business called/i).should("be.visible");
  });
});

describe("Onboarding wizard — data questions", () => {
  const PHONE = "+18435559003";
  // 1×1 transparent PNG.
  const PNG_B64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  function continueBtn() {
    return cy.contains("button", /^continue$/i);
  }

  it("answers every question and hides the dashboard SetupChecklist", () => {
    cy.startFreshOnboarding(PHONE);
    cy.visit("/welcome");

    cy.step("name");
    cy.get(".welcome__input", { timeout: 10_000 }).clear().type("Rafa");
    continueBtn().click();

    cy.step("business name");
    cy.contains(/what's your business called/i).should("be.visible");
    cy.get(".welcome__input").clear().type("Monster Roofing Co");
    continueBtn().click();

    cy.step("email");
    cy.contains(/best email/i).should("be.visible");
    cy.get(".welcome__input").clear().type("rafa@monsterroofing.com");
    continueBtn().click();

    cy.step("state — tap-to-confirm SC (843 area code)");
    cy.contains("button", /yes, south carolina/i, { timeout: 10_000 })
      .should("be.visible")
      .click();

    cy.step("address");
    cy.get('input[aria-label="Street address"]', { timeout: 10_000 })
      .clear().type("123 Palm Ave");
    cy.get('input[aria-label="City"]').clear().type("Charleston");
    cy.get('input[aria-label="ZIP"]').clear().type("29401");
    continueBtn().click();

    cy.step("payment — Venmo + handle");
    cy.contains("button", /^venmo$/i, { timeout: 10_000 }).click();
    cy.get('input[aria-label="@your-venmo"]').clear().type("@rafa");
    continueBtn().click();

    cy.step("logo — upload a PNG");
    cy.get('input[type="file"]', { timeout: 10_000 }).selectFile({
      contents: Cypress.Buffer.from(PNG_B64, "base64"),
      fileName: "logo.png",
      mimeType: "image/png",
    }, { force: true });
    cy.get(".welcome__logo-preview", { timeout: 10_000 }).should("be.visible");
    continueBtn().click();

    cy.step("insurance");
    cy.contains(/are you insured/i, { timeout: 10_000 }).should("be.visible");
    cy.get('input[aria-label="Insurance provider"]').clear().type("Acme Mutual");
    continueBtn().click();

    cy.step("everything persisted on /api/profile");
    cy.request("/api/profile").then((res) => {
      const p = res.body;
      expect(p.user.name).to.eq("Rafa");
      expect(p.user.email).to.eq("rafa@monsterroofing.com");
      expect(p.identity.businessName).to.eq("Monster Roofing Co");
      expect(p.identity.logoFileId, "logo saved").to.be.a("string").and.not.be
        .empty;
      expect(p.identity.acceptedPaymentMethods.venmo.enabled).to.eq(true);
      expect(p.identity.acceptedPaymentMethods.venmo.handle).to.eq("@rafa");
      expect(p.address.state).to.eq("SC");
      expect(p.address.street).to.eq("123 Palm Ave");
      expect(p.address.postal).to.eq("29401");
      expect(p.insurance.provider).to.eq("Acme Mutual");
    });

    cy.step("dashboard SetupChecklist self-hides once everything is done");
    cy.visit("/dashboard");
    cy.contains(/finish setting up|setup checklist/i).should("not.exist");
  });

  it("skipping everything leaves the SetupChecklist showing (safety net)", () => {
    cy.startFreshOnboarding(PHONE);
    cy.visit("/welcome");
    cy.contains("button", /skip setup for now/i, { timeout: 10_000 }).click();
    cy.location("pathname", { timeout: 10_000 }).should("eq", "/dashboard");
    cy.contains(/finish setting up|setup checklist/i, { timeout: 10_000 })
      .should("be.visible");
  });

  it("blocks Continue on an invalid email, then accepts a valid one", () => {
    cy.startFreshOnboarding(PHONE);
    cy.visit("/welcome");
    cy.get(".welcome__input", { timeout: 10_000 }).clear().type("Rafa");
    continueBtn().click();
    cy.contains(/what's your business called/i).should("be.visible");
    cy.get(".welcome__input").clear().type("Monster Roofing Co");
    continueBtn().click();

    cy.step("invalid email keeps Continue disabled + shows a message");
    cy.contains(/best email/i, { timeout: 10_000 }).should("be.visible");
    cy.get(".welcome__input").clear().type("not-an-email");
    cy.contains(/valid email/i).should("be.visible");
    continueBtn().should("be.disabled");

    cy.step("valid email persists");
    cy.get(".welcome__input").clear().type("rafa@x.com");
    continueBtn().should("not.be.disabled").click();
    cy.request("/api/me").its("body.email").should("eq", "rafa@x.com");
  });

  it("setting the state does not clobber an existing street/zip", () => {
    cy.startFreshOnboarding(PHONE);
    // Seed the parts that make earlier steps complete + an address street/zip.
    cy.request("PUT", "/api/me", { name: "Rafa", email: "rafa@x.com" });
    cy.request("PUT", "/api/profile/identity", { businessName: "Monster Co" });
    cy.request("PUT", "/api/profile/address", {
      street: "9 Palm Ave",
      postal: "29401",
    });

    cy.visit("/welcome");
    cy.step("resumes at the state step; confirm SC");
    cy.contains("button", /yes, south carolina/i, { timeout: 10_000 })
      .should("be.visible")
      .click();

    cy.step("state saved, street + zip untouched");
    cy.request("/api/profile").then((res) => {
      expect(res.body.address.state).to.eq("SC");
      expect(res.body.address.street).to.eq("9 Palm Ave");
      expect(res.body.address.postal).to.eq("29401");
    });
  });

  it("payment merge keeps a method enabled elsewhere", () => {
    cy.startFreshOnboarding(PHONE);
    // Complete every data step via API + pre-enable Zelle, so /welcome resumes
    // at logo; then Back into payment (advance/back is sequential).
    cy.request("PUT", "/api/me", { name: "Rafa", email: "rafa@x.com" });
    cy.request("PUT", "/api/profile/identity", {
      businessName: "Monster Co",
      acceptedPaymentMethods: { zelle: { enabled: true, handle: "z@x.com" } },
    });
    cy.request("PUT", "/api/profile/address", {
      street: "9 Palm Ave",
      state: "SC",
      postal: "29401",
    });

    cy.visit("/welcome");
    cy.step("resume lands on logo; Back to the payment step");
    cy.contains(/add your logo/i, { timeout: 10_000 }).should("be.visible");
    cy.contains("button", /^back$/i).click();

    cy.step("Zelle is already on; add Venmo and save");
    cy.contains(/how do you want to get paid/i).should("be.visible");
    cy.contains("button", /^zelle$/i).should("have.attr", "aria-pressed", "true");
    cy.contains("button", /^venmo$/i).click();
    cy.get('input[aria-label="@your-venmo"]').clear().type("@rafa");
    continueBtn().click();

    cy.step("both methods survive the merge");
    cy.request("/api/profile").then((res) => {
      const m = res.body.identity.acceptedPaymentMethods;
      expect(m.venmo.enabled).to.eq(true);
      expect(m.venmo.handle).to.eq("@rafa");
      expect(m.zelle.enabled).to.eq(true);
    });
  });
});

describe("Onboarding wizard — education + finish", () => {
  const PHONE = "+18435559004";

  // Seed every data step so /welcome resumes on the first education screen.
  function seedAllData() {
    cy.request("PUT", "/api/me", {
      name: "Rafa",
      email: "rafa@monsterroofing.com",
    });
    cy.request("PUT", "/api/profile/identity", {
      businessName: "Monster Roofing Co",
      logoFileId: "seed-logo",
      acceptedPaymentMethods: { venmo: { enabled: true, handle: "@rafa" } },
    });
    cy.request("PUT", "/api/profile/address", {
      street: "123 Palm Ave",
      state: "SC",
      postal: "29401",
    });
    cy.request("PUT", "/api/profile/insurance", { provider: "Acme Mutual" });
  }

  function continueBtn() {
    return cy.contains("button", /^continue$/i);
  }

  it("shows the Meet-Bossie screen with three example prompts after the data steps", () => {
    cy.startFreshOnboarding(PHONE);
    seedAllData();
    cy.visit("/welcome");
    cy.contains(/meet bossie/i, { timeout: 10_000 }).should("be.visible");
    cy.contains(/paver patio for the nguyens/i).should("be.visible");
    cy.contains(/invoice maria for the deck job/i).should("be.visible");
    cy.contains(/nudge tom about the bathroom quote/i).should("be.visible");
  });

  it("sample quote is branded with the business name, never 'Dev Business'", () => {
    cy.startFreshOnboarding(PHONE);
    seedAllData();
    cy.visit("/welcome");
    cy.step("advance to the sample-quote screen");
    continueBtn().click(); // meetBossie -> sampleQuote
    cy.contains(/see what your customer sees/i, { timeout: 10_000 })
      .should("be.visible");

    cy.step("create the sample and open its public page");
    cy.contains("button", /preview a sample quote/i).click();
    cy.get(".welcome__sample-link", { timeout: 10_000 })
      .should("have.attr", "href")
      .then((href) => {
        cy.visit(String(href));
        cy.contains(/monster roofing co/i, { timeout: 10_000 })
          .should("be.visible");
        cy.contains(/dev business/i).should("not.exist");
        cy.contains(/dev user/i).should("not.exist");
      });
  });

  it("picking a prompt chip lands in a seeded assistant chat", () => {
    cy.startFreshOnboarding(PHONE);
    seedAllData();
    cy.visit("/welcome");
    continueBtn().click(); // -> sampleQuote
    continueBtn().click(); // -> finish
    cy.contains(/you're all set/i, { timeout: 10_000 }).should("be.visible");

    cy.step("pick the quote chip → seeded /assistant chat");
    cy.contains("button", /paver patio for the nguyens/i).click();
    cy.location("pathname", { timeout: 15_000 }).should("match", /^\/assistant\//);
    cy.contains(/first quote|paver patio/i, { timeout: 15_000 })
      .should("be.visible");
  });

  it("'explore on my own' lands on the dashboard, and /welcome never traps again", () => {
    cy.startFreshOnboarding(PHONE);
    seedAllData();
    cy.visit("/welcome");
    continueBtn().click(); // -> sampleQuote
    continueBtn().click(); // -> finish
    cy.contains("button", /explore on my own/i, { timeout: 10_000 }).click();
    cy.location("pathname", { timeout: 10_000 }).should("eq", "/dashboard");

    cy.step("onboarding is finished — /welcome now bounces to /dashboard");
    cy.visit("/welcome");
    cy.location("pathname", { timeout: 10_000 }).should("eq", "/dashboard");
  });
});

describe("Onboarding wizard — entry points", () => {
  const PHONE = "+18435559005";

  it("new users are routed to /welcome; returning users to /dashboard?welcome=back", () => {
    cy.startFreshOnboarding(PHONE).then((r) => {
      expect(r.redirectTo, "fresh user → wizard").to.eq("/welcome");
    });
    // Second login, same phone, NOT wiped → returning user.
    cy.clearCookies();
    cy.request("POST", "/api/auth/send-otp", { phoneNumber: PHONE });
    cy.exec(`cd ../backend && deno run -A --unstable-kv scripts/dev-get-otp.ts ${PHONE}`)
      .then((res) => {
        const code = res.stdout.trim();
        cy.request("POST", "/api/auth/verify", { phoneNumber: PHONE, code })
          .its("body.redirectTo")
          .should("eq", "/dashboard?welcome=back");
      });
  });

  it("/assistant?onboard=1 forwards a not-yet-onboarded user to /welcome", () => {
    cy.startFreshOnboarding(PHONE);
    cy.visit("/assistant?onboard=1");
    cy.location("pathname", { timeout: 10_000 }).should("eq", "/welcome");
  });

  it("/assistant?onboard=1 forwards an already-onboarded user to /dashboard (via /welcome's guard)", () => {
    cy.startFreshOnboarding(PHONE);
    cy.request("POST", "/api/me/onboarded", { skipped: true });
    cy.visit("/assistant?onboard=1");
    cy.location("pathname", { timeout: 10_000 }).should("eq", "/dashboard");
  });

  it("a brand-new user who skipped setup can reach every core page (no gate)", () => {
    cy.startFreshOnboarding(PHONE);
    cy.request("POST", "/api/me/onboarded", { skipped: true });
    for (const path of ["/dashboard", "/quotes", "/invoices", "/clients", "/settings"]) {
      cy.visit(path);
      cy.location("pathname", { timeout: 10_000 }).should("eq", path);
    }
  });
});

describe("Onboarding wizard — polish (i18n / mobile / a11y)", () => {
  const PHONE = "+18435559006";

  it("renders the first question in Spanish for an es-language user", () => {
    cy.startFreshOnboarding(PHONE);
    cy.request("PUT", "/api/me", { language: "es" });
    cy.visit("/welcome");
    cy.contains(/cómo te llamamos/i, { timeout: 10_000 }).should("be.visible");
    cy.contains("button", /continuar/i).should("exist");
    cy.contains(/omitir configuración/i).should("exist");
  });

  it("defaults to Spanish pre-login when no language is chosen (Spanish-first app)", () => {
    // No account, no EN-preference cookie → the app is Spanish-first, so a
    // pre-login page must render in Spanish by default (Spanish digit labels).
    cy.clearCookie("pm_lang");
    cy.visit(`/verify?phone=${encodeURIComponent("+18435559123")}`);
    cy.get('input[aria-label="Dígito 1"]', { timeout: 10_000 }).should("exist");
  });

  it("mobile (375px): no horizontal scroll and mobile input attributes are set", () => {
    cy.viewport(375, 700);
    cy.startFreshOnboarding(PHONE);
    cy.visit("/welcome");

    cy.get(".welcome__input", { timeout: 10_000 })
      .should("have.attr", "autocomplete", "name")
      .and("have.attr", "enterkeyhint", "go");
    cy.document().then((doc) => {
      const el = doc.documentElement;
      expect(el.scrollWidth, "no horizontal overflow").to.be.at.most(
        el.clientWidth + 1,
      );
    });

    cy.step("email step carries type=email + inputmode=email");
    cy.get(".welcome__input").clear().type("Rafa");
    cy.contains("button", /^continue$/i).click();
    cy.get(".welcome__input").clear().type("Monster Roofing Co");
    cy.contains("button", /^continue$/i).click();
    cy.get(".welcome__input", { timeout: 10_000 })
      .should("have.attr", "type", "email")
      .and("have.attr", "inputmode", "email");
    cy.document().then((doc) => {
      const el = doc.documentElement;
      expect(el.scrollWidth, "no horizontal overflow on email step")
        .to.be.at.most(el.clientWidth + 1);
    });
  });

  it("auto-focuses the input on each step and has no critical a11y violations (3 steps)", () => {
    cy.startFreshOnboarding(PHONE);
    cy.visit("/welcome");
    cy.injectAxe();

    cy.step("step 1 (name) — input auto-focused, no critical violations");
    cy.get(".welcome__input", { timeout: 10_000 }).should("be.visible");
    cy.focused().should("have.class", "welcome__input");
    cy.checkA11y(undefined, { includedImpacts: ["critical"] });

    cy.step("advance → step 2 (business): focus moves to the new input");
    cy.focused().clear().type("Rafa");
    cy.contains("button", /^continue$/i).click();
    cy.focused().should("have.class", "welcome__input");
    cy.checkA11y(undefined, { includedImpacts: ["critical"] });

    cy.step("advance → step 3 (email): input focused, still clean");
    cy.focused().clear().type("Monster Roofing Co");
    cy.contains("button", /^continue$/i).click();
    cy.focused().should("have.class", "welcome__input");
    cy.checkA11y(undefined, { includedImpacts: ["critical"] });
  });
});
