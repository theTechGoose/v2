/// <reference types="cypress" />

/**
 * RED (TDD) — the /welcome onboarding wizard.
 *
 * UX-10 [WIZARD] "'Paso 1 de 10' announces a 10-step march before any value.
 * Steps 7-9 (logo, seguro, y el paso W-9 si aplica) are nice-to-haves parked
 * before the two payoff steps. Consider: fewer counted steps (fold
 * logo/insurance into the dashboard checklist it already has), or 'Paso 1 de
 * 4 + extras opcionales' framing." — a "consider" finding, so the pin is the
 * honest DISJUNCTION: either the tracker's counted total is ≤ 6, or every
 * nice-to-have step still present (logo / insurance / W-9) is EXPLICITLY
 * framed optional ("opcional") in the tracker or step copy. Nice-to-have
 * steps folded out of the wizard entirely also satisfy the second arm.
 *
 * UX-11 [WIZARD] "Step-4 double primary. 'Sí, Texas' (solid green) and
 * 'Continuar' (solid dark green) compete; unclear whether Continuar confirms
 * the guess. One primary." — pinned per the app's one-primary action-row
 * rule: at most ONE visible .welcome__btn--primary on the state-confirm card.
 *
 * Grounding (front-end/islands/WelcomeWizard.tsx + shared/quote-flow/
 * wizard-nav.ts, wizard-steps.ts — the step registry lives in the island):
 *   - buildSteps() (WelcomeWizard.tsx:1022-1090) registers 10 steps: name,
 *     businessName, email, state, address, payment, logo, insurance,
 *     meetBossie, sampleQuote. total = steps.length = 10.
 *   - tracker: .welcome__step-count renders t("welcome.stepOf") =
 *     "Paso {current} de {total}" (WelcomeWizard.tsx:1206-1208,
 *     lang/es.json welcome.stepOf).
 *   - step card: .welcome__card > .welcome__step with .welcome__question and
 *     .welcome__why (StepBody, WelcomeWizard.tsx:121-151). In the ES dict the
 *     ONLY steps whose question/why mention logo/seguro are the logo and
 *     insurance steps ("Agrega tu logo" / "¿Tienes seguro?") — neither is
 *     framed "opcional" anywhere (verified against lang/es.json; the lone
 *     "(opcional)" is the policy-number FIELD placeholder, which is about the
 *     field, not the step).
 *   - footer: StepFooter (WelcomeWizard.tsx:153-199) — Back ghost, Skip ghost
 *     inside .welcome__footer-right, and Continue as .welcome__btn--primary.
 *   - state step (WelcomeWizard.tsx:373-492): with a suggestedState (backend
 *     area-code guess — 512 ⇒ Texas; welcome.tsx:87) the tap-to-confirm
 *     banner .welcome__confirm renders "Sí, {state}" as
 *     .welcome__btn--primary (lines 428-442) WHILE StepFooter renders
 *     "Continuar" as a SECOND .welcome__btn--primary (lines 188-195) — and
 *     `selected` is initialized to the suggestion (line 376), so Continuar is
 *     enabled too. Live-verified (Playwright 2026-08-19): two visible
 *     .welcome__btn--primary, both rgb(81,152,67) — "Sí, Texas" + "Continuar".
 *   - "Omitir configuración por ahora" (.welcome__escape) sits OUTSIDE
 *     .welcome__card (WelcomeWizard.tsx:1215-1222), so card-scoped queries
 *     never count it.
 *
 * Phones: +15125556002 ONLY (this slice's wizard phone; startFreshOnboarding
 * wipes it — the wipe also clears the OTP record, so the P-03 send cooldown
 * never leaks between tests).
 */

const PHONE = "+15125556002";
const NAME = "Rafa Prueba";

interface StepInfo {
  count: string;
  question: string;
  why: string;
}

/** Parse "Paso 3 de 10" / "Step 3 of 10" → [current, total]. */
function parseCount(text: string): [number, number] {
  const m = text.match(/(\d+)\s*(?:de|of)\s*(\d+)/i);
  expect(m, `step tracker "${text}" reads "n de N"`).to.not.eq(null);
  return [Number(m![1]), Number(m![2])];
}

/**
 * Walk every wizard step from the current one, collecting tracker + copy for
 * each. Advances by Skip where offered (nothing is saved), by typing NAME on
 * the un-skippable name step, and by Continue on education steps. Stops ON
 * the final step (its Continue would finish onboarding and navigate away).
 */
function collectSteps(acc: StepInfo[], onDone: (steps: StepInfo[]) => void) {
  cy.get(".welcome__step-count").invoke("text").then((raw) => {
    const count = raw.trim();
    cy.get(".welcome__card").then(($card) => {
      const card = $card[0];
      acc.push({
        count,
        question:
          card.querySelector(".welcome__question")?.textContent?.trim() ?? "",
        why: card.querySelector(".welcome__why")?.textContent?.trim() ?? "",
      });
      const [cur, total] = parseCount(count);
      if (cur >= total) {
        onDone(acc);
        return;
      }
      const skip = card.querySelector<HTMLElement>(
        ".welcome__footer-right .welcome__btn--ghost",
      );
      if (skip) {
        cy.wrap(skip).click();
      } else {
        const input = card.querySelector<HTMLInputElement>(
          "input.welcome__input",
        );
        if (input && input.value.trim().length === 0) {
          cy.wrap(input).type(NAME);
        }
        cy.get(".welcome__card .welcome__btn--primary").first().click();
      }
      // The tracker text changing is the step-advanced signal (saves are
      // network round-trips; Cypress retries until it flips).
      cy.get(".welcome__step-count").should(($el) => {
        expect($el.text().trim()).not.to.eq(count);
      });
      collectSteps(acc, onDone);
    });
  });
}

describe("UX-10 / UX-11: welcome wizard steps", () => {
  beforeEach(() => {
    // Real fresh-onboarding state (wipes the phone, real OTP). Seeds EN, so
    // flip to the audited Spanish-first profile before entering the wizard.
    cy.startFreshOnboarding(PHONE);
    cy.apiUpdateUser({ language: "es" });
    cy.viewport(390, 844);
    cy.visit("/welcome");
    cy.get(".welcome__step-count").should("be.visible");
    // Language gate (not a finding assertion): the fresh wizard opens on the
    // ES name step — if the language PUT silently failed this fails loudly
    // here instead of mis-pinning Spanish copy on an English wizard.
    cy.contains(".welcome__question", "te llamamos").should("be.visible");
  });

  it("UX-10: the tracker counts ≤ 6 steps, or every nice-to-have step still present is explicitly framed optional", () => {
    cy.get(".welcome__step-count").invoke("text").then((raw) => {
      const [, total] = parseCount(raw.trim());
      if (total <= 6) {
        // Arm A — the march was shortened (e.g. logo/insurance folded into
        // the dashboard SetupChecklist). Done.
        expect(total, "counted steps").to.be.at.most(6);
        return;
      }
      // Arm B — a >6-step tracker is only honest if the nice-to-haves are
      // labeled optional. Walk the wizard (skips save nothing) and check
      // every logo/insurance/W-9 step's tracker + heading copy.
      // RED today: "Paso 1 de 10", and the logo step reads "Agrega tu logo"
      // ("Paso 7 de 10") with no optional framing anywhere; same for
      // "¿Tienes seguro?" ("Paso 8 de 10").
      collectSteps([], (steps) => {
        const extras = steps.filter((s) =>
          /logo|seguro|insurance|w-?9/i.test(`${s.question} ${s.why}`)
        );
        // Folded out entirely also satisfies the finding — but any that
        // REMAIN inside a >6-step march must say so ("opcional").
        for (const s of extras) {
          const copy = `${s.count} · ${s.question} · ${s.why}`;
          expect(
            copy,
            `nice-to-have step "${s.question}" is explicitly framed optional`,
          ).to.match(/opcional/i);
        }
      });
    });
  });

  it("UX-11: the state-confirm card has at most ONE solid primary button", () => {
    // Reach step 4: type the name (un-skippable), then skip businessName and
    // email. The 512 area code makes the backend suggest Texas, so the
    // tap-to-confirm banner renders.
    cy.get("input.welcome__input").type(NAME);
    cy.get(".welcome__card .welcome__btn--primary").click();
    cy.get(".welcome__footer-right .welcome__btn--ghost").click(); // skip business name
    cy.get(".welcome__footer-right .welcome__btn--ghost").click(); // skip email
    // The audited card: state question + tap-to-confirm banner.
    cy.contains(".welcome__question", "estado").should("be.visible");
    cy.get(".welcome__confirm").should("be.visible");

    cy.get(".welcome__card").then(($card) => {
      const card = $card[0];
      const visible = (el: HTMLElement) => el.offsetParent !== null;
      const buttons = Array.from(card.querySelectorAll("button")).filter(
        visible,
      );
      const primaries = buttons.filter((b) =>
        b.classList.contains("welcome__btn--primary")
      );
      // RED today: TWO — "Sí, Texas" (banner, WelcomeWizard.tsx:428-442) and
      // "Continuar" (footer, WelcomeWizard.tsx:188-195), live-measured with
      // the identical solid background rgb(81,152,67).
      const primaryNames = primaries.map((b) => b.textContent?.trim())
        .join(" | ");
      expect(
        primaries.length,
        `solid primary buttons on the state-confirm card [${primaryNames}]`,
      ).to.be.at.most(1);

      // Style-level guard: no second button may wear the primary's exact
      // solid background either (one-primary rule, not just one class).
      if (primaries.length === 1) {
        const bg = getComputedStyle(primaries[0]).backgroundColor;
        const sameBg = buttons.filter(
          (b) => getComputedStyle(b).backgroundColor === bg,
        );
        const sameBgNames = sameBg.map((b) => b.textContent?.trim())
          .join(" | ");
        expect(
          sameBg.length,
          `buttons sharing the primary's solid background [${sameBgNames}]`,
        ).to.be.at.most(1);
      }
    });
  });
});

export {};
