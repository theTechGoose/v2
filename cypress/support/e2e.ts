/// <reference types="cypress" />

/**
 * Global support file. Imported automatically by every spec via the
 * `supportFile` option in cypress.config.ts.
 *
 * Add shared commands here (e.g. cy.login, cy.seedInvoice) so individual
 * specs stay focused on user behavior.
 */

import "./commands";
import "cypress-axe";

// Inject axe-core into every page so cy.checkA11y() is available in specs.
beforeEach(() => {
  cy.injectAxe();
});

// ---------------------------------------------------------------------------
// Step hotkey: F9 (debugger "resume" convention) clicks Cypress's Resume
// button in the runner toolbar. Bound on the spec window AND every AUT
// window load, so it fires regardless of which iframe currently has focus
// — that's the only way around inputs in the app eating "c" / "n".
// ---------------------------------------------------------------------------

function findRunnerButton(label: RegExp): HTMLElement | null {
  try {
    const topDoc = window.top?.document;
    if (!topDoc) return null;
    const all = Array.from(
      topDoc.querySelectorAll("button, [role='button']"),
    ) as HTMLElement[];
    return (
      all.find((b) => {
        const txt = (b.textContent || "").trim();
        const aria = b.getAttribute("aria-label") || "";
        const title = b.getAttribute("title") || "";
        return label.test(txt) || label.test(aria) || label.test(title);
      }) ?? null
    );
  } catch {
    return null;
  }
}

function stepHotkeyHandler(e: KeyboardEvent) {
  // F9 = Resume (run until next cy.pause / end). F10 = Next command.
  if (e.key !== "F9" && e.key !== "F10") return;
  const btn = findRunnerButton(
    e.key === "F9" ? /\bresume\b/i : /\bnext\b/i,
  );
  if (btn) {
    e.preventDefault();
    e.stopPropagation();
    btn.click();
  }
}

// Bind on the spec/runner window (idempotent across reloads via the
// guard flag — the support file re-evaluates each spec run).
if (!(window as unknown as { __stepHotkeyBound?: boolean }).__stepHotkeyBound) {
  window.addEventListener("keydown", stepHotkeyHandler, true);
  (window as unknown as { __stepHotkeyBound?: boolean }).__stepHotkeyBound = true;
}

// Re-bind on every AUT window load — that's the iframe the user is usually
// focused in when they hit the key.
Cypress.on("window:before:load", (autWin: Window) => {
  autWin.addEventListener("keydown", stepHotkeyHandler, true);
});

// Fail loud on uncaught errors that originate in the app under test. The
// default is silent, which hides real bugs (e.g. a hydration mismatch on
// the public invoice page would otherwise pass).
Cypress.on("uncaught:exception", (err) => {
  // Carve out one known noisy warning from Preact dev that's not a real
  // failure. Anything else surfaces as a test failure.
  if (/Preact: registerComponent/.test(err.message)) return false;
  return true;
});
