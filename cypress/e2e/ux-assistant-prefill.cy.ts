/// <reference types="cypress" />

/**
 * UX-04 / UX-32 — UI halves of "the assistant is deaf to what the user
 * already typed" (ux-problems.md). RED specs: they pin the desired prefill
 * behavior; the deterministic extraction contract lives in
 * jest/unit/ux-quick-quote-prefill.test.ts (shared/quote-flow/quick-quote-
 * prefill).
 *
 *   UX-04 "The quick-quote line '…para la familia Nguyen, $3,700 todo
 *          incluido' is followed by a price screen starting at $0 ('¿Cuál es
 *          el precio?') and a customer screen asking '¿Para quién es esto?'
 *          — both answers were in the sentence."
 *   UX-32 "The facturar flow ignores what the app already knows. It opens
 *          with a cold '¿De qué trabajo es la factura?' instead of offering
 *          the just-accepted job as a chip; the typed '$3,700' is ignored
 *          (picker at $0, same as UX-04)."
 *
 * Stub-LLM honesty (P-10/P-20/P-26 precedent): everything asserted here is
 * deterministic under the stub — the quick-quote/facturar typed-details →
 * price-capture transition is pure client-side state (AsstChat.tsx
 * submitJobDetails:2208-2225 → setPriceCaptureOpen), no LLM turn involved.
 * LLM-quality name extraction is NOT asserted; only the regex-extractable
 * "$3,700" / "para la familia Nguyen" halves are.
 *
 * Grounded selectors (front-end/islands/AsstChat.tsx unless noted):
 *   starter chips        button.chat__empty-prompt (labels asstChat.prompt.*)
 *   composer             textarea.composer__input / button.composer__send
 *   price capture        .chat__price-capture (:4401) — MoneyInput mounted at
 *                        :4510-4518 with NO initialCents (the $0 bug)
 *   money input          input.mi__input (MoneyInput.tsx:250) — displays the
 *                        formatted amount ("3,700"); seeded via the
 *                        initialCents prop (MoneyInput.tsx:20-47)
 *   price continue       button.chat__price-continue (:4520-4534, disabled
 *                        while (priceCents ?? 0) <= 0)
 *   customer step (form) .cust-create input.cust-pick__search (:7342-7350 —
 *                        name input first; createName starts "")
 *   facturar first bubble .chat__details-prompt-bubble (:4042-4055 —
 *                        chipReply("invoiceDone", lang) from
 *                        shared/quote-flow/starter-chips.ts:43-45)
 *
 * ES setup per exemplar (assistant-experience.cy.ts): loginAs →
 * apiUpdateUser({language:"es"}) → clearCookie("pm_lang") → onboarded skip.
 *
 * Phones used: +15125556410, +15125556411, +15125556412 (contractors).
 * Seeded customers carry blackhole emails only — no extra phone numbers.
 */

// Module marker: keeps top-level declarations file-scoped so parallel spec
// files (which share the global script scope otherwise) don't collide.
export {};

const ES_CHIPS = {
  quickQuote: "Solo dame una cotización rápida.",
  invoiceDone: "Trabajo terminado, necesito facturar.",
};

// The audit's sentence: price AND customer are both in it.
const QQ_SENTENCE =
  "Instalación de patio de adoquines 20x15 para la familia Nguyen, $3,700 todo incluido";

function loginEs(phone: string) {
  cy.clearCookies();
  cy.loginAs(phone);
  cy.apiUpdateUser({ language: "es" });
  cy.clearCookie("pm_lang");
  cy.request("POST", "/api/me/onboarded", { skipped: true });
}

function startQuickQuoteWithSentence() {
  cy.visit("/assistant");
  cy.contains("button.chat__empty-prompt", ES_CHIPS.quickQuote)
    .should("be.visible")
    .click();
  cy.get("textarea.composer__input", { timeout: 10_000 })
    .should("be.visible")
    .type(QQ_SENTENCE);
  cy.get("button.composer__send").click();
  cy.get(".chat__price-capture", { timeout: 10_000 }).should("be.visible");
}

// ===========================================================================
// UX-04 — the price step opens AT the typed amount, not $0
// ===========================================================================
describe("UX-04 quick-quote price step prefills the typed $-amount", () => {
  const PHONE = "+15125556410";
  beforeEach(() => loginEs(PHONE));

  it("UX-04 the sentence's $3,700 lands in the price picker (input '3,700', Continue enabled)", () => {
    startQuickQuoteWithSentence();
    // RED today: AsstChat.tsx:4510-4518 passes no initialCents, so the
    // MoneyInput opens EMPTY ($0) even though the sentence said "$3,700".
    cy.get(".chat__price-capture input.mi__input").should(
      "have.value",
      "3,700",
    );
    // …and because priceCents is null, Continue is disabled — the user is
    // asked "¿Cuál es el precio?" they already answered. Desired: enabled.
    cy.get("button.chat__price-continue").should("not.be.disabled");
  });
});

// ===========================================================================
// UX-04 — the customer step carries the typed name candidate
// ===========================================================================
describe("UX-04 quick-quote customer step carries the typed name", () => {
  const PHONE = "+15125556411";
  beforeEach(() => loginEs(PHONE));

  it("UX-04 'para la familia Nguyen' prefills the customer-name field", () => {
    startQuickQuoteWithSentence();
    // Type the price manually (its own prefill red is the spec above) so the
    // flow can proceed: quote is created, phase 2 starts, and the wizard's
    // customer step renders (fresh user, zero saved customers → the panel
    // auto-jumps to the create form, AsstChat.tsx:7252-7259).
    cy.get(".chat__price-capture input.mi__input").type("3700");
    cy.get("button.chat__price-continue").should("not.be.disabled").click();
    cy.location("pathname", { timeout: 20_000 }).should(
      "match",
      /^\/assistant\/[A-Za-z0-9_-]+$/,
    );
    // RED today: createName starts "" (AsstChat.tsx:7342-7350) — nothing
    // carries "familia Nguyen" from the sentence into the step that asks
    // "¿Para quién es esto?". Desired: the extracted candidate ("Familia
    // Nguyen", per the quick-quote-prefill contract) prefills the name
    // input. (A "Usar a … del chat" chip naming Nguyen would serve the same
    // product intent, but the pinned contract is the prefilled input — it is
    // the affordance the existing form already has.)
    cy.openCustomerCreateForm();
    cy.get(".cust-create input.cust-pick__search", { timeout: 20_000 })
      .first()
      .invoke("val")
      .should("match", /nguyen/i);
  });
});

// ===========================================================================
// UX-32 — facturar offers the just-accepted job + prefills the typed amount
// ===========================================================================
describe("UX-32 facturar flow uses what the app already knows", () => {
  const PHONE = "+15125556412";
  const JOB_NAME = "Patio de adoquines";

  beforeEach(() => {
    loginEs(PHONE);
    // Seed an ACCEPTED quote via API: customer + quote (status flips to
    // "approved" on accept — the canonical accepted state, backend/src/
    // paperwork/entrypoints/public-controller/mod.ts:481-483).
    cy.apiCreateCustomer({
      name: "María Nguyen",
      email: "maria.nguyen.ux32@blackhole.postmarkapp.com",
    }).then((customerId: string) => {
      cy.apiCreateQuote({
        summary: "Instalación de patio de adoquines 20x15",
        jobName: JOB_NAME,
        description: "Instalación de patio de adoquines 20x15",
        lineItems: [
          { description: "Patio de adoquines", quantity: 1, unit: "job", price: 370000 },
        ],
        estimatedTotal: 370000,
        status: "sent",
        customerId,
      }).then((quoteId: string) => {
        cy.apiAcceptQuote(quoteId, {});
      });
    });
  });

  it("UX-32 the flow's first step offers the just-accepted job as a chip", () => {
    cy.visit("/assistant");
    cy.contains("button.chat__empty-prompt", ES_CHIPS.invoiceDone)
      .should("be.visible")
      .click();
    // The cold first bubble ("…¿De qué trabajo es la factura?") renders here
    // today (AsstChat.tsx:4042-4055) with NO memory of the accepted job.
    cy.get(".chat__details-prompt-bubble", { timeout: 10_000 }).should(
      "be.visible",
    );
    // RED today: no element in the chat offers "Patio de adoquines". Desired:
    // a tappable chip for the accepted job (label per acceptedJobChipLabel —
    // job name + customer + $3,700). The job name is the semantically
    // inevitable hook: any honest chip must name the job it bills.
    cy.get(".chat").contains(/Patio de adoquines/i, { timeout: 10_000 })
      .should("be.visible");
  });

  it("UX-32 the typed '$3,700' prefills the facturar price picker", () => {
    cy.visit("/assistant");
    cy.contains("button.chat__empty-prompt", ES_CHIPS.invoiceDone)
      .should("be.visible")
      .click();
    cy.get("textarea.composer__input", { timeout: 10_000 })
      .should("be.visible")
      .type("La factura del patio para la familia Nguyen, $3,700 todo incluido");
    cy.get("button.composer__send").click();
    cy.get(".chat__price-capture", { timeout: 10_000 }).should("be.visible");
    // RED today: same $0 picker as UX-04 (no initialCents at AsstChat.tsx:
    // 4510-4518, invoice branch shares the price capture).
    cy.get(".chat__price-capture input.mi__input").should(
      "have.value",
      "3,700",
    );
  });
});
