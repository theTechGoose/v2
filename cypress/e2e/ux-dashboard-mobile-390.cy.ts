/// <reference types="cypress" />

/**
 * RED (TDD) — UX-09 [DASHBOARD/MOBILE] "The activity panel header breaks at
 * 390px. 'Los monstruos han estado ocupados' renders one-word-per-line in a
 * sliver column and 'Registro complet…' is clipped by the right edge."
 *
 * Live measurements (Playwright, 390×844, ES user, 2026-08-19):
 *   - #activity .panel__head is a flex row whose children overflow it:
 *     scrollWidth 366 > clientWidth 344.
 *   - the subtitle span ("Los monstruos han estado ocupados") is squeezed to
 *     width 58px and wraps to 5 lines (one word per line).
 *   - the "Registro completo →" link's right edge lands at 389.3 while the
 *     #activity panel box ends at 368 with overflow:hidden — hence the
 *     visible "Registro complet…" clip.
 *
 * Selector grounding (front-end/components/DashSections.tsx:559-596 — the
 * Activity panel rendered by front-end/islands/DashboardPage.tsx:579):
 *   - panel:      div.panel#activity                    (line 564)
 *   - header:     .panel__head                          (line 565)
 *   - title:      h3.panel__title  "Lo que manejamos hoy"      (line 566)
 *   - subtitle:   direct-child <span> — activity.busySub /
 *                 activity.emptySub (lang/es.json:17-18)       (lines 567-571)
 *   - action:     a.panel__action[href="/activity"]
 *                 "Registro completo →" (lang/es.json:19)      (lines 572-574)
 *
 * Phones: +15125556020 ONLY (this slice's dashboard contractor). The
 * customer record uses no real phone (blackhole email only).
 */

const VP_W = 390;
const CONTRACTOR = "+15125556020";

/** Rendered line count from the element's box height vs its line-height
 *  (falls back to 1.4 × font-size when line-height is "normal"). */
function lineCount(el: HTMLElement): number {
  const cs = getComputedStyle(el);
  const fs = parseFloat(cs.fontSize);
  let lh = parseFloat(cs.lineHeight);
  if (!Number.isFinite(lh) || lh <= 0) lh = fs * 1.4;
  return Math.round(el.getBoundingClientRect().height / lh);
}

describe("UX-09: dashboard activity panel header at 390px", () => {
  before(() => {
    cy.loginAs(CONTRACTOR);
    // The audit is the Spanish-first profile; loginAs seeds an EN user.
    cy.apiUpdateUser({ language: "es" });
    // A real accepted quote so the feed is non-empty and the header shows
    // the audited "Los monstruos han estado ocupados" subtitle (busySub
    // renders only when items exist — DashSections.tsx:568-570).
    cy.apiCreateCustomer({
      name: "María Nguyen",
      email: "maria.ux09@blackhole.postmarkapp.com",
    }).then((customerId: string) => {
      cy.apiCreateQuote({
        summary: "Instalación de patio de adoquines",
        jobName: "Patio de adoquines",
        lineItems: [
          { description: "Patio", quantity: 1, unit: "job", price: 370000 },
        ],
        estimatedTotal: 370000,
        customerId,
      }).then((quoteId: string) => {
        cy.apiAcceptQuote(quoteId, { name: "María Nguyen" });
      });
    });
  });

  beforeEach(() => {
    cy.loginAs(CONTRACTOR);
    cy.viewport(VP_W, 844);
    cy.visit("/dashboard");
    cy.get("#activity .panel__head").should("be.visible");
    // Language gate (not a finding assertion): the audited header is the ES
    // one — if the language PUT silently failed this fails loudly here.
    cy.contains("#activity .panel__title", "Lo que manejamos").should(
      "be.visible",
    );
  });

  it('UX-09: the header\'s children fit inside the header box (no "Registro complet…" clip)', () => {
    // RED today: scrollWidth 366 > clientWidth 344 — the flex children spill
    // out of the header row and the panel's overflow:hidden cuts them.
    cy.get("#activity .panel__head").then(($head) => {
      const head = $head[0];
      expect(
        head.scrollWidth,
        `header content ${head.scrollWidth}px must fit its box ${head.clientWidth}px`,
      ).to.be.at.most(head.clientWidth + 1);
    });
  });

  it('UX-09: the "Registro completo →" link stays inside the panel (not clipped by its right edge)', () => {
    // RED today: link right edge 389.3 vs panel right 368 (overflow:hidden).
    cy.get("#activity").then(($panel) => {
      const panel = $panel[0].getBoundingClientRect();
      cy.get("#activity .panel__action").then(($a) => {
        const link = $a[0];
        const r = link.getBoundingClientRect();
        expect(
          r.right,
          `link right ${r.right.toFixed(1)} inside panel right ${
            panel.right.toFixed(1)
          }`,
        ).to.be.at.most(panel.right + 1);
        expect(
          r.right,
          `link right ${r.right.toFixed(1)} inside the ${VP_W}px viewport`,
        ).to.be.at.most(VP_W + 0.5);
        // And the link's own text is not internally truncated.
        expect(
          link.scrollWidth,
          "link text not truncated inside its own box",
        ).to.be.at.most(link.clientWidth + 1);
      });
    });
  });

  it("UX-09: the subtitle is not a one-word-per-line sliver column", () => {
    // RED today: the span is squeezed to 58px and wraps to 5 lines.
    // A fix may instead hide the subtitle on mobile — that passes (the pin
    // is only on what is shown).
    cy.get("#activity .panel__head").then(($head) => {
      const span = $head[0].querySelector<HTMLElement>(":scope > span");
      if (!span || span.offsetParent === null) return; // hidden — fine
      const width = span.getBoundingClientRect().width;
      const lines = lineCount(span);
      expect(
        lines,
        `subtitle "${span.textContent?.trim()}" renders ${lines} lines`,
      ).to.be.at.most(2);
      expect(
        width,
        `subtitle column width ${width.toFixed(1)}px is a readable column, not a sliver`,
      ).to.be.at.least(120);
    });
  });

  it("UX-09: the panel title keeps a readable column too", () => {
    // Guard: today the title holds 148px/1 line — this pins that a fix
    // doesn't rescue the subtitle by slivering the title instead.
    cy.get("#activity .panel__head .panel__title").then(($t) => {
      const el = $t[0];
      const width = el.getBoundingClientRect().width;
      expect(
        el.scrollWidth,
        "title text not truncated",
      ).to.be.at.most(el.clientWidth + 1);
      expect(
        width,
        `title width ${width.toFixed(1)}px`,
      ).to.be.at.least(100);
      expect(
        lineCount(el),
        "title line count",
      ).to.be.at.most(2);
    });
  });
});

export {};
