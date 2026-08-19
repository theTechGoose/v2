/// <reference types="cypress" />

/**
 * Assistant i18n + step-surface polish — UI halves of the first-session
 * audit (ux-problems.md). RED specs.
 *
 *   UX-12 "English divider chips inside the Spanish chat. 'A little more
 *          info' renders between Spanish bubbles during the quick-quote flow."
 *   UX-13 "Customer step nits. Two 'Atrás' controls in one card (top link +
 *          footer button); placeholders clipped in the half-width fields
 *          ('Número de tel', 'Correo (opcio…')."
 *   UX-14 "Thread list is unhelpful for returning users… should be job +
 *          customer ('Patio · María Nguyen'). The 'Nueva conversación'
 *          button shows a ⌘N hint inside the MOBILE drawer."
 *   UX-19 "Mobile empty-state says '¡Haz clic en una casilla…!'"
 *   UX-34 "'Haz clic aquí para clientes existentes' as the ES dropdown
 *          trigger."
 *   UX-35 (assistant bullets) "Assistant step cards/composer float
 *          mid-viewport with large dead space below … content should anchor
 *          near the composer." + "Garbled overlapping toast/header text at
 *          the top-left during invoice creation."
 *   UX-06 "The EN preview silently keeps the job details in Spanish… there
 *          is no 'traduciendo…'/failure indicator, so if translation fails
 *          in prod the user sends a mixed-language document without knowing."
 *
 * Stub-LLM honesty (P-10/P-20/P-26 precedent): every flow driven here is the
 * deterministic client-side/stub path (chip → typed details → price capture
 * is pure state; the ?dev seed is the exemplar path from
 * assistant-experience.cy.ts). UX-06's "not translated" state is made
 * deterministic by intercepting the translate call — under the stub it would
 * otherwise echo instantly (the P-26 finding).
 *
 * Grounded selectors:
 *   AsstChat.tsx  — chips button.chat__empty-prompt; composer
 *     textarea.composer__input / button.composer__send; price capture
 *     .chat__price-capture + input.mi__input (MoneyInput.tsx:250) +
 *     button.chat__price-continue; divider .phase-divider__label
 *     (:4716-4721, label = dp.label ?? m.content frozen at store time,
 *     :4684); empty-state h3.chat__empty-title (:3569-3571); invoice
 *     customer step top back button .chat__price-back "Atrás" (:4362-4388)
 *     + create-form footer .cust-create__btn "Atrás" (:7414-7421); the two
 *     half-width inputs .cust-create__row input (:7367-7384); dropdown
 *     trigger .cust-dd__trigger > .cust-dd__placeholder (:7477-7502);
 *     .quote-review + .quote-review__langpill (:5092+); ?dev seed
 *     .chat__empty-debug-btn (:4579).
 *   AsstThreads.tsx — drawer dock (mobile) mirrors the sidebar's sb--open
 *     (:39-67); new-conversation ⌘N hint .threads__new-kbd rendered
 *     UNCONDITIONALLY (:192-194, asstThreads.newKbd "⌘N"); thread row title
 *     .thread__client via titleFor (:248-251).
 *   Layout — .chat__scroll / .chat__empty (assistant-page.css:7874:
 *     justify-content:center → the mid-viewport float); mobile hamburger
 *     button.topbar__menu[data-cy=mobile-menu] (DashTopbar).
 *   RedirectToast.tsx — [role=status], fires only on ?from=messages.
 *
 * Phones used: +15125556420 … +15125556428 (contractors). Seeded customers
 * carry blackhole emails only.
 */

// Module marker: keeps top-level declarations file-scoped so parallel spec
// files (which share the global script scope otherwise) don't collide.
export {};

const ES_CHIPS = {
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

/** Drive the facturar flow to its customer step (fresh user → create form). */
function facturarToCustomerStep() {
  cy.visit("/assistant");
  cy.contains("button.chat__empty-prompt", ES_CHIPS.invoiceDone)
    .should("be.visible")
    .click();
  cy.get("textarea.composer__input", { timeout: 10_000 })
    .should("be.visible")
    .type("Pintar la sala, dos manos");
  cy.get("button.composer__send").click();
  cy.get(".chat__price-capture", { timeout: 10_000 }).should("be.visible");
  cy.get(".chat__price-capture input.mi__input").type("2000");
  cy.get("button.chat__price-continue").should("not.be.disabled").click();
  // Fresh user, zero saved customers → CustomerStepPanel auto-jumps to the
  // create form (AsstChat.tsx:7252-7259).
  cy.openCustomerCreateForm();
  cy.get(".cust-create", { timeout: 15_000 }).should("be.visible");
}

// ===========================================================================
// UX-12 — no English divider chip inside the ES flow
// ===========================================================================
describe("UX-12 ES quick-quote flow has no English phase divider", () => {
  const PHONE = "+15125556420";
  beforeEach(() => loginEs(PHONE));

  it("UX-12 the divider between phases reads 'Un poco más de información', never 'A little more info'", () => {
    cy.visit("/assistant");
    cy.contains("button.chat__empty-prompt", ES_CHIPS.quickQuote)
      .should("be.visible")
      .click();
    cy.get("textarea.composer__input", { timeout: 10_000 })
      .should("be.visible")
      .type("Reparar la cerca del patio trasero, tres postes nuevos");
    cy.get("button.composer__send").click();
    cy.get(".chat__price-capture", { timeout: 10_000 }).should("be.visible");
    cy.get(".chat__price-capture input.mi__input").type("500");
    cy.get("button.chat__price-continue").should("not.be.disabled").click();
    // startQuoteFromRaw → POST transition-to-terms (AsstChat.tsx:1979, no
    // lang) → redirect to the thread. The divider is STORED at that moment.
    cy.location("pathname", { timeout: 20_000 }).should(
      "match",
      /^\/assistant\/[A-Za-z0-9_-]+$/,
    );
    // RED today: the transition coordinator defaults lang to "en"
    // (transition-to-terms/mod.ts:41-42) because no caller passes it, so the
    // stored divider is en.json:2466 "A little more info" — rendered frozen
    // between Spanish bubbles (AsstChat.tsx:4684, :4716-4721).
    cy.get(".phase-divider__label", { timeout: 20_000 })
      .first()
      .invoke("text")
      .then((t) => {
        const label = String(t).replace(/\s+/g, " ").trim();
        expect(label, "ES divider label").to.not.match(/a little more info/i);
        // es.json:2466 — the copy already exists; the fix must plumb lang.
        expect(label, "ES divider label").to.match(
          /un poco más de información/i,
        );
      });
  });
});

// ===========================================================================
// UX-13 — customer step: ONE Atrás, placeholders that fit
// ===========================================================================
describe("UX-13 customer step back-control and placeholder fit (390×844)", () => {
  const PHONE = "+15125556421";
  beforeEach(() => {
    cy.viewport(390, 844);
    loginEs(PHONE);
    facturarToCustomerStep();
  });

  it("UX-13 ZERO in-card 'Atrás' controls — the header back is the single one (2026-08-19)", () => {
    // Single-back rule supersedes the original UX-13 resolution: NO widget
    // or chat-message back button at all. The header a.chat__head-btn
    // (icon-only, so not counted by the text filter) is the one back
    // control; the create form's old footer "Atrás" became the forward
    // "Elige un cliente existente" affordance.
    cy.get(".chat").should(($chat) => {
      const backs = $chat
        .find("button:visible, a:visible")
        .filter((_i, el) => (el.textContent ?? "").trim() === "Atrás");
      expect(backs.length, "visible 'Atrás' controls in the step card").to.eq(
        0,
      );
    });
    cy.get("a.chat__head-btn").should("have.length", 1);
  });

  it("UX-13 the two half-width placeholders fit their fields (no clipping)", () => {
    // The audit saw "Número de tel" / "Correo (opcio…" at 390px. An empty
    // input's scrollWidth ignores the placeholder, so measure by
    // substituting the placeholder as the value, asserting
    // scrollWidth <= clientWidth, then restoring.
    cy.get(".cust-create__row input").should("have.length", 2);
    cy.get(".cust-create__row input").each(($input) => {
      const el = $input[0] as HTMLInputElement;
      const placeholder = el.placeholder;
      expect(placeholder, "placeholder present").to.have.length.greaterThan(0);
      el.value = placeholder;
      const fits = el.scrollWidth <= el.clientWidth;
      el.value = "";
      expect(
        fits,
        `placeholder "${placeholder}" fits its field (scrollWidth <= clientWidth)`,
      ).to.eq(true);
    });
  });
});

// ===========================================================================
// UX-14 — thread titles carry job · customer; no ⌘N in the mobile drawer
// ===========================================================================
describe("UX-14 thread list titles and mobile keyboard hint", () => {
  it("UX-14 a thread with a known job + customer titles '«job» · «customer»'", () => {
    const PHONE = "+15125556422";
    loginEs(PHONE);
    // Seed the knowledge the title must surface: customer + quote bound to a
    // conversation (POST /agents/conversations accepts {customerId, quoteId}
    // — conversations-controller/mod.ts:47-52).
    cy.apiCreateCustomer({
      name: "María Nguyen",
      email: "maria.nguyen.ux14@blackhole.postmarkapp.com",
    }).then((customerId: string) => {
      cy.apiCreateQuote({
        summary: "Instalación de patio de adoquines",
        jobName: "Patio de adoquines",
        description: "Instalación de patio de adoquines 20x15",
        lineItems: [
          { description: "Patio", quantity: 1, unit: "job", price: 370000 },
        ],
        estimatedTotal: 370000,
        customerId,
      }).then((quoteId: string) => {
        cy.request("POST", "/api/agents/conversations", {
          customerId,
          quoteId,
        });
      });
    });
    cy.viewport(1440, 900);
    cy.visit("/assistant");
    // RED today: titleFor (AsstThreads.tsx:248-251) is customerName || title
    // || "Nueva conversación", and the list projection (GET
    // /agents/conversations → store.listByUser) denormalizes NEITHER jobName
    // nor customerName (backend/src/agents/dto/conversation.ts:17-37) — the
    // row renders the "Nueva conversación" fallback, never the job+customer
    // the thread is actually about.
    cy.get(".thread__client", { timeout: 10_000 })
      .first()
      .invoke("text")
      .should("match", /Patio de adoquines\s*·\s*María Nguyen/);
  });

  it("UX-14 the 390px drawer shows NO desktop ⌘N keyboard hint", () => {
    const PHONE = "+15125556423";
    loginEs(PHONE);
    cy.viewport(390, 844);
    cy.visit("/assistant");
    cy.get("button.topbar__menu[data-cy=mobile-menu]", { timeout: 10_000 })
      .should("be.visible")
      .click();
    // The conversation dock rides along with the drawer (AsstThreads.tsx:
    // 33-67, P-22 fix) — wait for it, then assert the kbd chip is absent.
    cy.contains(/Conversaciones/i, { timeout: 10_000 }).should("be.visible");
    // RED today: .threads__new-kbd renders unconditionally (AsstThreads.tsx:
    // 192-194) — a desktop-keyboard hint ("⌘N") inside a phone drawer
    // (P-53's cousin).
    cy.get(".threads__new-kbd").should("not.be.visible");
  });
});

// ===========================================================================
// UX-19 — ES empty state: touch-first copy, chips not checkboxes
// ===========================================================================
describe("UX-19 ES assistant empty-state copy (rendered surface)", () => {
  const PHONE = "+15125556424";

  it("UX-19 the empty-state title says 'Toca…', never 'Haz clic'/'casilla'", () => {
    loginEs(PHONE);
    cy.viewport(390, 844);
    cy.visit("/assistant");
    // RED today (es.json:217): "¡Haz clic en una casilla o en el campo de
    // texto de abajo para comenzar!" rendered at AsstChat.tsx:3569-3571.
    cy.get("h3.chat__empty-title", { timeout: 10_000 })
      .should("be.visible")
      .invoke("text")
      .then((t) => {
        const title = String(t).trim();
        expect(title, "ES empty-state title").to.not.match(/haz clic/i);
        expect(title, "ES empty-state title").to.not.match(/casilla/i);
        expect(title, "ES empty-state title").to.match(/\btoca\b/i);
      });
  });
});

// ===========================================================================
// UX-34 — ES existing-customer dropdown trigger
// ===========================================================================
describe("UX-34 ES existing-customer dropdown trigger copy", () => {
  const PHONE = "+15125556425";

  it("UX-34 the trigger matches the fixed EN pattern ('Elige…'), not 'Haz clic aquí…'", () => {
    loginEs(PHONE);
    // Seed one saved customer so the customer step renders the DROPDOWN
    // (list view) instead of auto-jumping to the create form.
    cy.apiCreateCustomer({
      name: "Pedro Salazar",
      email: "pedro.salazar.ux34@blackhole.postmarkapp.com",
    });
    facturarToCustomerStepWithList();
    // RED today (es.json:190): "Haz clic aquí para clientes existentes" —
    // the EN twin was already fixed to "Choose an existing customer"
    // (en.json:190). Rendered at AsstChat.tsx:7483-7485.
    cy.get(".cust-dd__trigger .cust-dd__placeholder", { timeout: 15_000 })
      .should("be.visible")
      .invoke("text")
      .then((t) => {
        const label = String(t).trim();
        expect(label, "ES dropdown trigger").to.not.match(/haz clic/i);
        expect(label, "ES dropdown trigger").to.match(
          /^(elige|escoge|selecciona)\b/i,
        );
      });
  });

  /** Same drive as facturarToCustomerStep but landing on the LIST view
   *  (a saved customer exists, so no auto-jump to the form). */
  function facturarToCustomerStepWithList() {
    cy.visit("/assistant");
    cy.contains("button.chat__empty-prompt", ES_CHIPS.invoiceDone)
      .should("be.visible")
      .click();
    cy.get("textarea.composer__input", { timeout: 10_000 })
      .should("be.visible")
      .type("Pintar la sala, dos manos");
    cy.get("button.composer__send").click();
    cy.get(".chat__price-capture", { timeout: 10_000 }).should("be.visible");
    cy.get(".chat__price-capture input.mi__input").type("2000");
    cy.get("button.chat__price-continue").should("not.be.disabled").click();
  }
});

// ===========================================================================
// UX-35 (assistant bullets) — step card anchored low; no toast/header overlap
// ===========================================================================
describe("UX-35 assistant step-card anchoring and top-chrome overlap", () => {
  it("UX-35 the step card anchors near the bottom of the chat panel (no mid-viewport float)", () => {
    const PHONE = "+15125556426";
    loginEs(PHONE);
    cy.viewport(1440, 900);
    facturarToCustomerStep();
    // RED today: .chat__empty centers its content vertically
    // (assistant-page.css:7874 justify-content:center), so the customer step
    // card floats mid-viewport with a large dead band below it (the audit's
    // screenshot). Desired: the card hugs the bottom of the panel — where
    // the composer lives on conversational steps — leaving at most a small
    // gap. 140px is the documented heuristic for "anchored": a centered
    // card in a ~700px-tall panel measures well above it, an anchored card
    // well below.
    cy.get(".chat__price-capture").then(($card) => {
      cy.get(".chat__scroll, .chat").first().then(($panel) => {
        const card = $card[0].getBoundingClientRect();
        const panel = $panel[0].getBoundingClientRect();
        const deadSpaceBelow = panel.bottom - card.bottom;
        expect(
          deadSpaceBelow,
          `dead space below the step card (${Math.round(deadSpaceBelow)}px)`,
        ).to.be.at.most(140);
      });
    });
  });

  it("UX-35 [contract-pin, green by design] a visible toast never overlaps the chat header box", () => {
    // HONESTY NOTE: the audit's garbled overlap ("two strings rendered on
    // top of each other for a few seconds" during invoice creation) could
    // not be deterministically reproduced from source — no unconditional
    // toast exists on /assistant (RedirectToast fires only on
    // ?from=messages). Per the brief, the measurable invariant is pinned as
    // a labeled contract-pin instead of a faked red: with the one
    // deterministic toast forced visible, its box must not intersect the
    // chat header's box. The RED for UX-35 lives in the dead-space spec
    // above.
    const PHONE = "+15125556427";
    loginEs(PHONE);
    cy.viewport(1440, 900);
    cy.visit("/assistant?from=messages"); // RedirectToast.tsx: shows ~6s
    cy.get("[role=status]", { timeout: 10_000 }).should("be.visible");
    cy.get("[role=status]").then(($toast) => {
      cy.get(".chat__head").then(($head) => {
        const a = $toast[0].getBoundingClientRect();
        const b = $head[0].getBoundingClientRect();
        const intersects = a.left < b.right && b.left < a.right &&
          a.top < b.bottom && b.top < a.bottom;
        expect(intersects, "toast box intersects chat header box").to.eq(
          false,
        );
      });
    });
  });
});

// ===========================================================================
// UX-06 — the EN preview must expose a visible translation state
// ===========================================================================
describe("UX-06 preview surfaces a translation state instead of silent ES", () => {
  const PHONE = "+15125556428";

  function pickFirstOption() {
    cy.get(".wiz__opts .wiz-opt:not(.wiz-opt--custom)", { timeout: 15_000 })
      .filter(":visible")
      .first()
      .click();
  }

  it("UX-06 when the EN toggle is on and the details are NOT translated, a status indicator exists", () => {
    loginEs(PHONE);
    // Both send languages so the "Preview in" toggle renders (exemplar:
    // assistant-experience.cy.ts P-26).
    cy.apiUpdateProfile({ commsLanguages: ["es", "en"] });
    // Make "not translated" DETERMINISTIC: fail the lazy translate call
    // (AsstChat.tsx ensureDescriptionLang:790-815 — its catch silently
    // "keep[s] the base description"). Under the stub it would otherwise
    // echo instantly (P-26), which is exactly the unfalsifiable half we do
    // NOT assert.
    cy.intercept("POST", "**/agents/job-details/translate*", {
      statusCode: 500,
      body: { error: "translate down (ux-06 fixture)" },
    });
    // ?dev seed → quote + conversation + terms (exemplar path).
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
    cy.get(".cust-create input[type=email]").type(
      "cliente.ux06@blackhole.postmarkapp.com",
    );
    cy.get(".cust-create__btn--primary").should("not.be.disabled").click();
    // Remaining wizard steps: first ready-made option each.
    pickFirstOption();
    pickFirstOption();
    pickFirstOption();
    pickFirstOption();
    cy.get(".quote-review", { timeout: 20_000 }).should("be.visible");
    // Toggle the preview to English.
    cy.get(".quote-review__langpill").contains(/english|ingl[eé]s/i).click();
    // RED today: the preview silently falls back to the Spanish description
    // (AsstChat.tsx:4895-4897 quote.descriptionByLang[previewLang] ??
    // base) with NO indicator anywhere — no "traduciendo…" state, no
    // failure notice (no such string exists in either dict). Desired: a
    // visible translation-state element inside the preview while the
    // toggled language's details are missing/failed.
    cy.get(".quote-review")
      .contains(
        /traduciendo|traducci[oó]n|sin traducir|no se pudo traducir|translat/i,
        { timeout: 10_000 },
      )
      .should("be.visible");
  });
});
