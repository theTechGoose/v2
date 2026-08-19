/// <reference types="cypress" />

/**
 * UX-07 — "The assistant coachmark fires AFTER mastery and can feel stuck."
 * (ux-problems.md)
 *
 *   "It appeared on the desktop dashboard after the user had already created,
 *    sent, and won a quote through the assistant — full-app blur, 'haz clic
 *    en cualquier lugar para cerrar', but Escape does nothing and clicks over
 *    some regions are intercepted by underlying panels (live-reproduced:
 *    click retries exhausted on .panel__head). Also mixes metaphors ('Haz
 *    clic aquí… Toca para empezar'). Suppress once the user has used the
 *    assistant; dismiss on Escape and on ANY pointerdown at the overlay
 *    level."
 *
 * Grounding (front-end/islands/AssistantCoachmark.tsx, read in full):
 *   - Mounted unconditionally on /dashboard (routes/dashboard/index.tsx:79).
 *   - Trigger: ONLY localStorage "pm:assistant-coachmark-shown" (:4, :47-51)
 *     — assistant usage is never consulted, so a returning power user on a
 *     fresh browser still gets the full-app veil (the (a) red).
 *   - Requires the sidebar pill a[href="/assistant"].sb__textus on screen
 *     (:53-67, retries 30×120ms ≈ 3.6s) → desktop viewport (1440×900) here.
 *   - Dismiss: a document-level "click" capture listener only (:101-106).
 *     NO keydown handler → Escape does nothing (the (b) red). NO pointerdown
 *     handling → a pointerdown that never becomes a click (press-drag over a
 *     panel, the audit's intercepted-click case) does nothing (the (c) red).
 *   - Overlay root: div[role=dialog] aria-label assistantCoachmark.ariaLabel,
 *     pointer-events:none (:135-145) → force-trigger to prove handling at
 *     the overlay's own level.
 *   - Copy: heading es "Haz clic aquí para hablar con tu asistente"
 *     (lang/es.json:29) + body "…Toca para empezar." (es.json:27) — the
 *     mixed-metaphor (d) red.
 *
 * Phones used: +15125556400, +15125556401, +15125556402, +15125556403.
 */

// Module marker: keeps top-level declarations file-scoped so parallel spec
// files (which share the global script scope otherwise) don't collide.
export {};

// The coachmark bubble heading, either UI language (islands may render EN
// for a frame before langSignal settles — match both, assert on the dialog).
const HEADING_RE = /para hablar con tu asistente|talk to your assistant/i;
const DIALOG = "div[role=dialog]";

function loginEs(phone: string) {
  cy.clearCookies();
  cy.loginAs(phone);
  cy.apiUpdateUser({ language: "es" });
  cy.clearCookie("pm_lang");
  cy.request("POST", "/api/me/onboarded", { skipped: true });
}

function visitDashboardDesktop() {
  cy.viewport(1440, 900);
  cy.visit("/dashboard");
  // The spotlight target must exist before the coachmark's find-loop can
  // possibly fire (AssistantCoachmark.tsx:53-67).
  cy.get('a[href="/assistant"].sb__textus', { timeout: 10_000 }).should(
    "be.visible",
  );
}

// ===========================================================================
// (a) — no coachmark for a user who has already used the assistant
// ===========================================================================
describe("UX-07 coachmark is suppressed once the assistant has been used", () => {
  const PHONE = "+15125556400";

  it("UX-07 a user with an existing assistant conversation sees NO coachmark", () => {
    loginEs(PHONE);
    // Seed real assistant usage via the API (a conversation of their own —
    // the same signal the threads sidebar lists).
    cy.request("POST", "/api/agents/conversations", {})
      .its("body.id")
      .should("be.a", "string");
    visitDashboardDesktop();
    // Give the find-loop its full window (30 retries × 120ms ≈ 3.6s +
    // entrance) — the coachmark must never appear, not merely "not yet".
    // RED today: suppression is localStorage-only (a fresh browser knows
    // nothing), so the veil covers the dashboard of a user who has already
    // used the assistant.
    cy.wait(4500);
    cy.contains(DIALOG, HEADING_RE).should("not.exist");
  });
});

// ===========================================================================
// (b) — Escape dismisses
// ===========================================================================
describe("UX-07 coachmark dismisses on Escape", () => {
  const PHONE = "+15125556401";

  it("UX-07 pressing Escape closes the coachmark", () => {
    loginEs(PHONE);
    visitDashboardDesktop();
    cy.contains(DIALOG, HEADING_RE, { timeout: 10_000 }).should("be.visible");
    // RED today: AssistantCoachmark.tsx has no keydown listener at all —
    // the dismiss hint says "haz clic en cualquier lugar" and Escape is inert.
    cy.get("body").type("{esc}");
    cy.contains(DIALOG, HEADING_RE).should("not.exist");
  });
});

// ===========================================================================
// (c) — ANY pointerdown at the overlay level dismisses
// ===========================================================================
describe("UX-07 coachmark dismisses on pointerdown at the overlay level", () => {
  const PHONE = "+15125556402";

  it("UX-07 a pointerdown on the overlay (over a panel region) closes it", () => {
    loginEs(PHONE);
    visitDashboardDesktop();
    cy.contains(DIALOG, HEADING_RE, { timeout: 10_000 }).should("be.visible");
    // The audit's stuck case: over some regions the *click* never completes
    // (underlying panels intercept / press-drag). Desired: the OVERLAY
    // handles pointerdown itself, so the gesture's first event dismisses.
    // force + explicit PointerEvent because the overlay is pointer-events:
    // none (AssistantCoachmark.tsx:138) — this proves handling at its level.
    // RED today: only a document "click" capture exists (:101-106); a
    // pointerdown that never becomes a click leaves the veil up.
    cy.contains(DIALOG, HEADING_RE).trigger("pointerdown", {
      force: true,
      eventConstructor: "PointerEvent",
      pointerType: "mouse",
    });
    cy.contains(DIALOG, HEADING_RE).should("not.exist");
  });
});

// ===========================================================================
// (d) — one input metaphor per surface
// ===========================================================================
describe("UX-07 coachmark copy keeps one input metaphor", () => {
  const PHONE = "+15125556403";

  it("UX-07 the coachmark never mixes 'Haz clic' and 'Toca' on one surface", () => {
    loginEs(PHONE);
    visitDashboardDesktop();
    cy.contains(DIALOG, HEADING_RE, { timeout: 10_000 })
      .should("be.visible")
      .invoke("text")
      .then((t) => {
        const text = String(t).replace(/\s+/g, " ");
        const hasClick = /haz clic/i.test(text);
        const hasTouch = /\btoca\b/i.test(text);
        // RED today: heading "Haz clic aquí…" (es.json:29) + body "…Toca
        // para empezar." (es.json:27) render together in the bubble.
        expect(
          hasClick && hasTouch,
          `coachmark mixes metaphors: ${text}`,
        ).to.eq(false);
      });
  });
});
