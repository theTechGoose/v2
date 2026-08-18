/// <reference types="cypress" />

/**
 * P-ids covered:
 *   "P-04 [SIGNUP/I18N] The Spanish onboarding tells users to type 'omitir' — which the backend never accepts. Infinite loop."
 *   "P-23 [ASSISTANT/I18N] The Spanish chat doesn't understand 'sí'."
 *   "P-33 [I18N] ES users never get the post-onboarding payoff (identity refresh + 'see what your customer sees' demo CTA)."
 *   "P-52 [PRODUCT] Two names for the assistant: onboarding/coachmark say 'Bossie'… remove bossie."
 *
 * Drives the REAL chat onboarding for a fresh Spanish user. The chat state
 * machine is the backstop for existing half-onboarded users; a fresh master-OTP
 * user lands there when they visit /assistant and start typing.
 *
 * Selectors reused from assistant.cy.ts: textarea.composer__input,
 * button.composer__send, .msg (assistant bubbles), .msg--user (user bubbles).
 * The onboarding banner + quick-reply chips render only on
 *   /assistant/<threadId>?onboard=1   (front-end/routes/assistant/[threadId].tsx:80,115)
 * via islands/OnboardingProgress.tsx (chips at lines 266-291).
 */
describe("onboarding — Spanish skip/confirm intents + payoff + brand", () => {
  // Exact Spanish copy from lang/es.json — copied verbatim so the prod fix
  // makes these pass without editing the test.
  const ES = {
    askBusiness: "¿Y cómo se llama tu negocio?", // onboarding.askBusiness
    stateGuess: "Parece que estás en", // onboarding.askStateGuess
    address: "La última,", // onboarding.askAddress
    payout: "Una cosa más,", // onboarding.askPayout
    handoff: "ya está todo listo", // onboarding.handoff
    addressReprompt: "no pude interpretar eso", // onboardingChat.address.reprompt
    stateReprompt: "no reconocí eso", // onboardingChat.state.reprompt
    chipYes: "Sí — está correcto", // onboardingProgress.reply.yes
    demoTitle: "Mira lo que ve tu cliente", // asstChat.demo.title — the payoff CTA
  };

  function say(text: string) {
    cy.get("textarea.composer__input", { timeout: 10_000 })
      .should("be.visible")
      .clear()
      .type(text, { delay: 0 });
    cy.get("button.composer__send").click();
  }

  function startSpanish(phone: string) {
    cy.clearCookies();
    cy.startFreshOnboarding(phone);
    // Deterministic: seed a real name so onboarding starts at the business
    // step, and force the contractor's UI language to Spanish.
    cy.apiUpdateUser({ name: "Diego", language: "es" });
    cy.clearCookie("pm_lang");
  }

  it("P-04: typing 'omitir' at the address step advances the chat (payout ask appears, reprompt does not)", () => {
    startSpanish("+15125552140");
    cy.visit("/assistant");

    say("hola");
    cy.contains(".msg", ES.askBusiness, { timeout: 10_000 }).should("be.visible");

    say("Riley Roofing");
    cy.contains(".msg", ES.stateGuess, { timeout: 10_000 }).should("be.visible");

    say("TX");
    cy.contains(".msg", ES.address, { timeout: 10_000 }).should("be.visible");

    // 'omitir' is exactly what the ES composer/reprompt tell the user to type.
    say("omitir");
    // Desired: chat advances to the payout ask. Red today: the address reprompt.
    cy.contains(".msg", ES.payout, { timeout: 10_000 }).should("be.visible");
    cy.contains(ES.addressReprompt).should("not.exist");
  });

  it("P-23: clicking the 'Sí — está correcto' chip renders a Spanish user bubble (not 'Yes')", () => {
    startSpanish("+15125552141");
    cy.visit("/assistant");

    // Walk name+biz so the pending onboarding step is STATE (banner step 2).
    say("hola");
    cy.contains(".msg", ES.askBusiness, { timeout: 10_000 }).should("be.visible");
    say("Riley Roofing");
    cy.contains(".msg", ES.stateGuess, { timeout: 10_000 }).should("be.visible");

    // The banner + chips only render on the thread page with ?onboard=1.
    cy.location("pathname", { timeout: 10_000 })
      .should("match", /^\/assistant\/[a-zA-Z0-9_-]+$/)
      .then((pathname) => {
        cy.visit(`${pathname}?onboard=1`);
      });

    // Chips exist (step 2: "Sí — está correcto" / "Otro estado").
    cy.contains("button", ES.chipYes, { timeout: 10_000 }).should("be.visible");
    cy.contains("button", "Otro estado").should("exist");

    // Click the Spanish "yes" chip.
    cy.contains("button", ES.chipYes).click();

    // Desired: the chip dispatches the SAME Spanish text it displays, so the
    // user's own bubble reads Spanish. Red today: it dispatches raw "Yes", so
    // the Spanish user sees themselves "speaking English".
    cy.get(".msg--user").last().should("contain.text", "Sí");
    cy.get(".msg--user").last().should("not.contain.text", "Yes");
  });

  it("P-33: an ES onboarding completion fires the 'see what your customer sees' demo payoff", () => {
    startSpanish("+15125552142");
    cy.visit("/assistant");

    say("hola");
    cy.contains(".msg", ES.askBusiness, { timeout: 10_000 }).should("be.visible");
    say("Riley Roofing");
    cy.contains(".msg", ES.stateGuess, { timeout: 10_000 }).should("be.visible");
    say("TX");
    cy.contains(".msg", ES.address, { timeout: 10_000 }).should("be.visible");
    say("skip"); // English skip works today — keeps this test independent of P-04
    cy.contains(".msg", ES.payout, { timeout: 10_000 }).should("be.visible");
    say("venmo @rafa, rafa@example.com");

    // The handoff arrives (Spanish).
    cy.contains(".msg", ES.handoff, { timeout: 10_000 }).should("be.visible");

    // Desired: the payoff fires for Spanish too — the demo CTA is appended.
    // Red today: ack detection string-matches English ("Awesome — we're set,"),
    // so for ES the handoff never matches and the CTA never renders.
    cy.contains(ES.demoTitle, { timeout: 10_000 }).should("be.visible");
  });

  it("P-52: 'Bossie' is not shown anywhere in the onboarding / coachmark surfaces", () => {
    startSpanish("+15125552143");

    // Dashboard carries the assistant CTA + first-visit coachmark, both of
    // which name the assistant "Bossie" today (lang/es.json dashAssistantCta.sub,
    // assistantCoachmark.body). Desired: the brand is gone.
    cy.visit("/dashboard");
    cy.contains("Bossie").should("not.exist");

    // And the assistant onboarding surface.
    cy.visit("/assistant");
    cy.get("textarea.composer__input", { timeout: 10_000 }).should("be.visible");
    cy.contains("Bossie").should("not.exist");
  });
});
