/// <reference types="cypress" />

/**
 * Assistant experience — live-UI RED tests for the first-2-hours audit.
 * One quoted problem line per P-id:
 *
 *   P-20 "All four starter chips return the identical canned reply — including
 *        'Trabajo terminado, necesito facturar', which is answered with quote copy."
 *   P-21 "Terminology whiplash at the send moment." (header 'Redactando contrato',
 *        confirmation 'Contrato enviado para firma', ALL-CAPS chip, truncated email)
 *   P-22 "Past conversations unreachable on mobile; mid-flow work silently lost."
 *   P-24 "The 'choose a version' step undermines trust." (titles '… (2)/(3)';
 *        tapping a card's text opens inline editing instead of selecting)
 *   P-25 "Manual terms controls write English into Spanish contracts."
 *   P-26 "The 'English out' promise fails in the preview." (EN send button reads
 *        'Click here to send by Text + Email')
 *   P-53 "Desktop-keyboard hint on the mobile amount picker: 'Shift = $100'."
 *
 * Spanish-first app. ES setup per exemplar: loginAs → apiUpdateUser({language:"es"})
 * → clearCookie("pm_lang") → me/onboarded {skipped:true}.
 *
 * Grounded selectors (front-end/islands/AsstChat.tsx):
 *   starter chips        button.chat__empty-prompt  (labels asstChat.prompt.*)
 *   details bubble       .chat__details-prompt-bubble           (:3825)
 *   job-option cards      .chat__jobopt / title .chat__jobopt-name-btn
 *                         / inline edit input .chat__jobopt-name-edit
 *                         / selected class .is-selected           (:3458-3534)
 *   price capture        .chat__price-capture / MoneyInput .mi .mi__input .mi__words
 *   money hint           .mi__words → moneyInput.hintKeyboard "… Shift = $100" (:285-287)
 *   mobile hamburger     button.topbar__menu[data-cy=mobile-menu] (DashTopbar:118-123)
 *   conversation history "Conversaciones" (asstThreads.conversations, AsstThreads island)
 *   dev seed             /assistant?dev → .chat__empty-debug-btn (seedPhase2 → /assistant/<id>)
 *   customer step form    .cust-create input.cust-pick__search / .cust-create__btn--primary
 *   wizard options       .wiz__opts .wiz-opt / custom .wiz-opt--custom (:6174)
 *   duration editor      .dur__preview-val → preview "3 weeks" (:7705/7922-7926)
 *   preview card         .quote-review / send .quote-review__send-main / lang pill
 *                         .quote-review__langpill (:4846-4868, 5628-5670)
 *   send label (EN)      asstChat.preview.sendBoth "Click here to send by Text + Email"
 */

const ES_CHIPS = {
  knownPrice: "Sé mi precio, redáctalo.",
  helpPrice: "Conozco el trabajo, ayúdame a ponerle precio.",
  quickQuote: "Solo dame una cotización rápida.",
  invoiceDone: "Trabajo terminado, necesito facturar.",
};

function loginEs(phone: string) {
  cy.clearCookies();
  cy.loginAs(phone);
  cy.apiUpdateUser({ language: "es" });
  cy.clearCookie("pm_lang");
  cy.request("POST", "/api/me/onboarded", { skipped: true });
}

// ===========================================================================
// P-20 — each chip must lead to a distinct, intent-appropriate reply
// ===========================================================================
describe("P-20 starter chips route to distinct, intent-appropriate replies", () => {
  const PHONE = "+15125553020";
  beforeEach(() => loginEs(PHONE));

  it("P-20 the four chips are NOT one canned reply; the invoice chip talks about facturas", () => {
    // Each chip currently drops into the SAME generic details bubble
    // ("Muy bien — cuéntame los detalles del trabajo."), so all four are
    // identical and the invoice chip never mentions invoicing. Desired: a
    // distinct, intent-appropriate first reply per chip; the invoice one is
    // about factura(s).
    const seen: string[] = [];
    const order = [
      ES_CHIPS.knownPrice,
      ES_CHIPS.helpPrice,
      ES_CHIPS.quickQuote,
      ES_CHIPS.invoiceDone,
    ];
    order.forEach((label) => {
      cy.visit("/assistant"); // fresh conversation each time
      cy.contains("button.chat__empty-prompt", label).should("be.visible").click();
      cy.get(".chat__details-prompt-bubble", { timeout: 10_000 })
        .should("be.visible")
        .invoke("text")
        .then((t) => seen.push(String(t).replace(/\s+/g, " ").trim()));
    });
    cy.then(() => {
      // RED today: Set size === 1 (all identical).
      expect(new Set(seen).size, `chip replies: ${JSON.stringify(seen)}`).to.be
        .greaterThan(1);
      // RED today: the invoice chip's reply is quote copy, no "factur".
      expect(seen[3], "invoice-chip reply").to.match(/factur/i);
      expect(seen[3], "invoice-chip reply").to.not.match(/cotiz/i);
    });
  });
});

// ===========================================================================
// P-24 — "choose a version" mechanics: distinct titles + tap-to-select
// ===========================================================================
describe("P-24 choose-a-version step selects on tap and shows distinct titles", () => {
  const PHONE = "+15125553021";
  const DETALLES = "Reparar la cerca del patio trasero, tres postes nuevos";
  beforeEach(() => {
    loginEs(PHONE);
    cy.visit("/assistant");
    cy.contains("button.chat__empty-prompt", ES_CHIPS.helpPrice)
      .should("be.visible")
      .click();
    cy.get("textarea.composer__input", { timeout: 10_000 })
      .should("be.visible")
      .type(DETALLES);
    cy.get("button.composer__send").click();
    // The Job-Details "versions" picker (3 editable option cards).
    cy.get(".chat__jobopt", { timeout: 20_000 }).should("have.length", 3);
  });

  it("P-24 the three version titles are distinct with no '(2)/(3)' suffix scheme", () => {
    cy.get(".chat__jobopt .chat__jobopt-name-btn").then(($els) => {
      const titles = [...$els].map((e) =>
        (e.textContent ?? "").replace(/✎/g, "").replace(/\s+/g, " ").trim()
      );
      // Distinct (guard) AND — the RED — none ends in "(2)" / "(3)".
      expect(new Set(titles).size, `titles: ${JSON.stringify(titles)}`).to.eq(
        titles.length,
      );
      titles.forEach((t) =>
        expect(t, `title "${t}" must not carry a (n) suffix`).to.not.match(
          /\(\d\)\s*$/,
        )
      );
    });
  });

  it("P-24 tapping a card's text SELECTS it (no inline-edit / keyboard on first tap)", () => {
    // Use the 2nd card (the 1st is pre-selected by default, so it can't prove
    // that a tap performed the selection).
    cy.get(".chat__jobopt").eq(1).find(".chat__jobopt-name-btn").click();
    // Desired: the card becomes selected …
    cy.get(".chat__jobopt").eq(1).should("have.class", "is-selected");
    // … and NO text input is focused (today it opens .chat__jobopt-name-edit).
    cy.focused().should("not.match", "input, textarea, [contenteditable]");
    cy.get(".chat__jobopt-name-edit").should("not.exist");
  });
});

// ===========================================================================
// P-53 — no desktop "Shift" hint on the mobile amount picker
// ===========================================================================
describe("P-53 mobile amount picker hides the Shift hint", () => {
  const PHONE = "+15125553022";
  beforeEach(() => loginEs(PHONE));

  it("P-53 at a 390px viewport the price screen shows no 'Shift' hint", () => {
    cy.viewport(390, 844);
    cy.visit("/assistant");
    cy.contains("button.chat__empty-prompt", ES_CHIPS.knownPrice)
      .should("be.visible")
      .click();
    cy.get("textarea.composer__input", { timeout: 10_000 })
      .should("be.visible")
      .type("Reemplazar 6 paneles de cerca en el lado sur.");
    cy.get("button.composer__send").click();
    cy.get(".chat__price-capture", { timeout: 10_000 }).should("be.visible");
    // RED today: MoneyInput picks the keyboard hint (matchMedia hover/pointer,
    // not viewport), so ".mi__words" renders "… Shift = $100" on the phone.
    cy.contains("Shift").should("not.exist");
  });
});

// ===========================================================================
// P-22 — mobile: conversation history reachable + URL carries the id early
// ===========================================================================
describe("P-22 mobile conversation history + early conversation id", () => {
  const PHONE = "+15125553023";
  beforeEach(() => loginEs(PHONE));

  it("P-22 the URL gains a conversation id as soon as a flow starts", () => {
    cy.viewport(390, 844);
    cy.visit("/assistant");
    cy.contains("button.chat__empty-prompt", ES_CHIPS.knownPrice)
      .should("be.visible")
      .click();
    cy.get("textarea.composer__input", { timeout: 10_000 })
      .should("be.visible")
      .type("Reemplazar 6 paneles de cerca.");
    cy.get("button.composer__send").click();
    cy.get(".chat__price-capture", { timeout: 10_000 }).should("be.visible");
    // RED today: mid-flow the URL is still "/assistant" (the id is minted only
    // when the quote is created), so navigating away loses the work.
    cy.location("pathname").should("match", /^\/assistant\/[A-Za-z0-9_-]+$/);
  });

  it("P-22 the 390px hamburger exposes conversation history, not just nav links", () => {
    cy.viewport(390, 844);
    cy.visit("/assistant");
    cy.get("button.topbar__menu[data-cy=mobile-menu]", { timeout: 10_000 })
      .should("be.visible")
      .click();
    // RED today: the mobile drawer holds nav links only — the conversation
    // list (AsstThreads "Conversaciones") is not reachable from it.
    cy.contains(/Conversaciones/i, { timeout: 10_000 }).should("be.visible");
  });
});

// ===========================================================================
// P-25 — manual terms controls localize the SUBMITTED string
// ---------------------------------------------------------------------------
// DEEP LIVE FLOW: reaches the terms wizard via the ?dev seed shortcut
// (seedPhase2 → quote → conversation → transition-to-terms → /assistant/<id>),
// answers the customer + start_date steps, then opens the "wraps" (duration)
// custom editor. The green agent may need to tune step-driving; the ASSERTION
// (.dur__preview-val localized) is the grounded red.
// ===========================================================================
describe("P-25 manual duration control is localized in Spanish", () => {
  const PHONE = "+15125553024";
  beforeEach(() => loginEs(PHONE));

  function seedToTerms() {
    cy.visit("/assistant?dev");
    cy.get(".chat__empty-debug-btn", { timeout: 10_000 })
      .should("be.visible")
      .click();
    cy.location("pathname", { timeout: 20_000 })
      .should("match", /^\/assistant\/[A-Za-z0-9_-]+$/);
  }

  it("P-25 the duration preview reads '3 semanas', never the EN '3 weeks'", () => {
    seedToTerms();
    // customer step (fresh user → create form): name + a contact, then Next.
    cy.openCustomerCreateForm();
    cy.get(".cust-create input.cust-pick__search", { timeout: 20_000 })
      .first()
      .type("Cliente Prueba");
    cy.get(".cust-create input[type=email]").type(
      "cliente@example-empresa.com",
    );
    cy.get(".cust-create__btn--primary").should("not.be.disabled").click();
    // start_date step: take the first ready-made option to advance.
    cy.get(".wiz__opts .wiz-opt:not(.wiz-opt--custom)", { timeout: 15_000 })
      .filter(":visible")
      .first()
      .click();
    // wraps (duration) step: open the manual/custom editor.
    cy.get(".wiz-opt--custom", { timeout: 15_000 })
      .filter(":visible")
      .first()
      .click();
    // Default state is n=3, unit=weeks → preview "3 weeks" today (EN into an
    // ES contract). Desired: localized "3 semanas".
    cy.get(".dur__preview-val", { timeout: 10_000 })
      .invoke("text")
      .then((t) => {
        const val = String(t).trim();
        expect(val, "duration preview").to.match(/semanas/i);
        expect(val, "duration preview").to.not.match(/weeks?/i);
      });
  });
});

// ===========================================================================
// P-26 — the preview's EN send button must not shout "Click here"
// ---------------------------------------------------------------------------
// DEEP LIVE FLOW: needs a completed terms wizard to reach the .quote-review
// preview, plus two send languages so the "Preview in" toggle renders. The EN
// send label is the grounded red (ES labels are already clean:
// "Enviar por texto + correo"); the EN "Click here to send by Text + Email"
// only shows once the preview is toggled to English.
// ===========================================================================
describe("P-26 preview EN send button has no 'Click here' prefix", () => {
  const PHONE = "+15125553025";
  beforeEach(() => {
    loginEs(PHONE);
    // Enable both send languages so the preview language toggle appears.
    cy.apiUpdateProfile({ commsLanguages: ["es", "en"] });
  });

  function pickFirstOption() {
    cy.get(".wiz__opts .wiz-opt:not(.wiz-opt--custom)", { timeout: 15_000 })
      .filter(":visible")
      .first()
      .click();
  }

  it("P-26 toggling the preview to English shows a clean send label (no 'Click here')", () => {
    cy.visit("/assistant?dev");
    cy.get(".chat__empty-debug-btn", { timeout: 10_000 })
      .should("be.visible")
      .click();
    cy.location("pathname", { timeout: 20_000 })
      .should("match", /^\/assistant\/[A-Za-z0-9_-]+$/);
    // customer step
    cy.openCustomerCreateForm();
    cy.get(".cust-create input.cust-pick__search", { timeout: 20_000 })
      .first()
      .type("Cliente Prueba");
    cy.get(".cust-create input[type=email]").type("cliente@example-empresa.com");
    cy.get(".cust-create__btn--primary").should("not.be.disabled").click();
    // Drive the remaining wizard steps (start_date, wraps, payment, warranty)
    // by taking the first ready-made option each time.
    pickFirstOption();
    pickFirstOption();
    pickFirstOption();
    pickFirstOption();
    // Editable review/preview opens when the wizard completes.
    cy.get(".quote-review", { timeout: 20_000 }).should("be.visible");
    // Toggle the preview to English (endonym pill "English"/"Inglés").
    cy.get(".quote-review__langpill").contains(/english|ingl[eé]s/i).click();
    // RED today: the EN button reads "Click here to send by Text + Email".
    cy.get(".quote-review__send-main")
      .invoke("text")
      .then((t) =>
        expect(String(t).trim(), "EN send label").to.not.match(
          /click here|haz clic aqu/i,
        )
      );
  });
});

// ===========================================================================
// P-21 — one term at the send moment, no ALL-CAPS, full email
// ---------------------------------------------------------------------------
// DEEPEST LIVE FLOW: completes the terms wizard, opens the preview and clicks
// send. Asserts the drafting/confirmation chrome brands the "Cotización +
// Acuerdo" the user built (not "Redactando contrato" / "Contrato enviado para
// firma"), the send divider chip is not ALL-CAPS, and the toast/divider shows
// the FULL customer email. Grounded strings from lang/es.json; the green agent
// may need to tune the wizard-driving path.
// ===========================================================================
describe("P-21 send moment keeps one term, no shouting, full email", () => {
  const PHONE = "+15125553026";
  const LONG_EMAIL = "prueba.cliente.direccion.larga@example-empresa-larga.com";
  beforeEach(() => loginEs(PHONE));

  function pickFirstOption() {
    cy.get(".wiz__opts .wiz-opt:not(.wiz-opt--custom)", { timeout: 15_000 })
      .filter(":visible")
      .first()
      .click();
  }

  it("P-21 drafting header, confirmation and chip stay 'Cotización'; email is whole", () => {
    cy.visit("/assistant?dev");
    cy.get(".chat__empty-debug-btn", { timeout: 10_000 })
      .should("be.visible")
      .click();
    cy.location("pathname", { timeout: 20_000 })
      .should("match", /^\/assistant\/[A-Za-z0-9_-]+$/);
    // customer step — seed a long-ish email so a truncated toast is provable.
    cy.openCustomerCreateForm();
    cy.get(".cust-create input.cust-pick__search", { timeout: 20_000 })
      .first()
      .type("Cliente Prueba");
    cy.get(".cust-create input[type=email]").type(LONG_EMAIL);
    cy.get(".cust-create__btn--primary").should("not.be.disabled").click();
    // Complete the remaining wizard steps.
    pickFirstOption();
    pickFirstOption();
    pickFirstOption();
    pickFirstOption();
    cy.get(".quote-review", { timeout: 20_000 }).should("be.visible");

    // RED today: the DRAFTING chrome flips to "Redactando contrato" — the user
    // built a "Cotización + Acuerdo".
    cy.get(".chat").should("not.contain.text", "Redactando contrato");

    // Send it.
    cy.get(".quote-review__send-main").should("be.visible").click();

    // RED today: confirmation reads "Contrato enviado para firma".
    cy.get(".chat", { timeout: 20_000 })
      .should("not.contain.text", "Contrato enviado para firma");

    // The send-confirmation chip must not be ALL-CAPS shouting, and it must
    // show the WHOLE email (today the toast truncates it mid-address).
    cy.contains(new RegExp(LONG_EMAIL.replace(/[.]/g, "\\."), "i"), {
      timeout: 20_000,
    })
      .should("be.visible")
      .invoke("text")
      .then((t) => {
        const text = String(t).trim();
        // Not shouting: the rendered chip differs from its own upper-casing.
        expect(text, "chip must not be ALL-CAPS").to.not.eq(text.toUpperCase());
        // The complete email is present (no mid-address truncation).
        expect(text, "chip shows full email").to.contain(LONG_EMAIL);
      });
  });
});
