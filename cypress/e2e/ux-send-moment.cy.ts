/// <reference types="cypress" />

/**
 * RED (TDD) — UX-03: the first send confirmation must be truthful and speak
 * ONE document term.
 *
 * Finding (ux-problems.md, verbatim fragment):
 *  UX-03 "[SEND MOMENT] The first send confirmation is self-contradictory.
 *         The confirmation card fuses 'Contrato enviado ✓' with 'no hay
 *         correo registrado — agrega uno a María Nguyen **para enviar**' —
 *         did it send or not? (It sent, by text.) Plus the terminology
 *         whiplash survives in this exact moment: header says 'Cotización +
 *         Acuerdo enviada para firma' while the card and the chip both say
 *         '**Contrato** enviado…' and the thread badge says 'Contrato
 *         enviado'."
 *
 * Relationship to P-21 (assistant-experience.cy.ts): P-21 pinned the
 * DRAFTING header, the "Contrato enviado para firma" confirmation string,
 * the ALL-CAPS chip and the truncated email — all now green. This spec
 * EXTENDS it to the send-moment CARD for an EMAIL-LESS customer (text-only
 * send) and to the thread badge; it does not re-assert P-21's pins.
 *
 * WHY the card contradicts itself (file:line verified, AsstChat.tsx):
 *  - :4838-4853 — after send, the divider scan reads ONLY emailedTo /
 *    emailFailureReason (never textedTo/smsFailureReason), so an SMS-only
 *    success leaves dispatchedTo undefined; sentRecipient then falls back to
 *    customer.email — undefined for an email-less customer.
 *  - :6118-6155 — the reviewed card titles "Contrato enviado"
 *    (asstChat.cta.contractSent, lang/es.json:175) with a ✓ icon, and the
 *    empty sentRecipient branch renders asstChat.cta.noEmailPre + name +
 *    asstChat.cta.toDeliver: "no hay correo registrado — agrega uno a
 *    <María Nguyen> para enviar" (lang/es.json:181,187) — directly under the
 *    sent-✓ claim, even though the text DID go out (the server divider says
 *    "Contrato enviado por mensaje de texto a …",
 *    sendContract.divider.texted, lang/es.json:2294).
 *  - Term whiplash sources at this moment: header
 *    asstChat.header.contractOutForSignature "Cotización + Acuerdo enviada
 *    para firma" (AsstChat.tsx:1207-1208, rendered in .chat__head-sub via
 *    ChatHeaderLive) vs card title "Contrato enviado" vs divider chip
 *    "Contrato enviado por mensaje de texto…" vs thread badge
 *    asstThreads.chip.contractSent "Contrato enviado"
 *    (AsstThreads.tsx:275-277, .thread__chip).
 *
 * Scenario: seeded ES contractor (cy.loginAs + language es, the P-21
 * exemplar), quote to an EMAIL-LESS customer (phone only) through the
 * deterministic dev wizard entry; phone-only customers auto-select the SMS
 * channel (AsstChat.tsx:1043-1052), so .quote-review__send-main IS the
 * "Enviar por texto" send.
 *
 * Grounded selectors: dev seed /assistant?dev → .chat__empty-debug-btn
 * (AsstChat.tsx:4569-4585); customer form .cust-create (AsstChat.tsx:
 * 7341-7411); wizard options .wiz__opts .wiz-opt; preview .quote-review,
 * send .quote-review__send-main (:5891-5904); confirmation card
 * .continue-cta--done / .continue-cta__title / .continue-cta__sub
 * (:6102-6155); header .chat__head-sub (ChatHeaderLive.tsx:71-75); thread
 * badge .thread__chip (AsstThreads.tsx:233-236).
 *
 * Phones used (reserved block +15125556200…6299):
 *   +15125556240 contractor, +15125556241 customer (email-less).
 */

// Namespaced (cypress specs share one script scope — plain PHONE consts
// collide across files at typecheck time).
const UX03_PHONE = "+15125556240";
const UX03_CUSTOMER_PHONE = "+15125556241";

function ux03LoginEs() {
  cy.clearCookies();
  cy.loginAs(UX03_PHONE);
  cy.apiUpdateUser({ language: "es", name: "Marta Contratista" });
  cy.clearCookie("pm_lang");
  cy.request("POST", "/api/me/onboarded", { skipped: true });
}

/** Drive: dev seed → phone-only customer → remaining wizard steps → preview. */
function ux03DriveToPreview() {
  cy.visit("/assistant?dev");
  cy.get(".chat__empty-debug-btn", { timeout: 10_000 }).should("be.visible").click();
  cy.location("pathname", { timeout: 20_000 })
    .should("match", /^\/assistant\/[A-Za-z0-9-]+$/);

  cy.openCustomerCreateForm();
  cy.get(".cust-create input.cust-pick__search", { timeout: 20_000 })
    .first()
    .type("María Nguyen");
  cy.get(".cust-create input[type=tel]").type(UX03_CUSTOMER_PHONE);
  // NO email — the exact audited persona; SMS becomes the default channel.
  cy.get(".cust-create__btn--primary").should("not.be.disabled").click();

  const pickFirstOption = () =>
    cy.get(".wiz__opts .wiz-opt:not(.wiz-opt--custom)", { timeout: 15_000 })
      .filter(":visible")
      .first()
      .click();
  pickFirstOption(); // start_date
  pickFirstOption(); // wraps
  pickFirstOption(); // payment_terms
  pickFirstOption(); // warranty

  cy.get(".quote-review", { timeout: 20_000 }).should("be.visible");
}

describe("UX-03: send moment — truthful confirmation, one document term", () => {
  beforeEach(() => {
    cy.viewport(1280, 800); // desktop: keep the threads sidebar in view
    ux03LoginEs();
  });

  it("UX-03: the text-send confirmation never claims sent-✓ AND 'agrega un correo para enviar' at once", () => {
    ux03DriveToPreview();
    // Phone-only customer ⇒ sendChannel auto-defaults to "sms"
    // (AsstChat.tsx:1043-1052) — this click is the "Enviar por texto" send.
    cy.get(".quote-review__send-main").should("be.visible").click();

    // Anchor (green today): the send DID happen by text — the server divider
    // acknowledges the channel (sendContract.divider.texted).
    cy.get(".chat", { timeout: 20_000 })
      .should(($chat) => {
        expect($chat.text(), "a text-send acknowledgment exists")
          .to.match(/mensaje de texto|texted to/i);
      });

    // RED today: the reviewed card claims success while its sub-line says
    // "no hay correo registrado — agrega uno a María Nguyen para enviar"
    // (AsstChat.tsx:6144-6153 — the empty-sentRecipient branch). Desired:
    // the sub reports the text send (recipient/channel); adding an email is
    // optional follow-up, never framed as required "para enviar".
    cy.get(".continue-cta--done", { timeout: 20_000 })
      .should("be.visible")
      .find(".continue-cta__sub")
      .should(($sub) => {
        const text = $sub.text();
        expect(text, "no 'missing email' failure copy under a sent-✓ claim")
          .not.to.match(/no hay correo registrado|no email on file/i);
        expect(text, "email must not be framed as required to deliver")
          .not.to.match(/para enviar|to deliver/i);
        expect(text, "the sub reports the actual channel: sent by text")
          .to.match(/texto|sms|text/i);
      });
  });

  it("UX-03: header, card and divider chip speak ONE term at the send moment", () => {
    ux03DriveToPreview();
    cy.get(".quote-review__send-main").should("be.visible").click();
    cy.get(".continue-cta--done", { timeout: 20_000 }).should("be.visible");

    // Anchor (green today, P-21's frozen decision): the header brands the
    // document the user built — "Cotización + Acuerdo enviada para firma".
    cy.get(".chat__head-sub")
      .invoke("text")
      .should("match", /cotización/i);

    // RED today: in the SAME viewport the card titles "Contrato enviado"
    // (asstChat.cta.contractSent) and the divider chip reads "Contrato
    // enviado por mensaje de texto a …" (sendContract.divider.texted) —
    // a second term for the same document, at the exact aha moment.
    cy.get(".chat").should("not.contain.text", "Contrato enviado");
  });

  it("UX-03: the thread badge keeps the same term after the send", () => {
    ux03DriveToPreview();
    cy.get(".quote-review__send-main").should("be.visible").click();
    cy.get(".continue-cta--done", { timeout: 20_000 }).should("be.visible");

    // Reload so the threads sidebar re-renders from the persisted
    // conversation (contractStatus "sent" ⇒ deriveChip returns
    // asstThreads.chip.contractSent — AsstThreads.tsx:275-277).
    cy.reload();
    // RED today: the active thread's badge reads "Contrato enviado".
    cy.get(".thread__chip", { timeout: 20_000 })
      .first()
      .invoke("text")
      .should((text) => {
        expect(text, "thread badge must not introduce the 'Contrato' term")
          .not.to.match(/contrato/i);
      });
  });
});
