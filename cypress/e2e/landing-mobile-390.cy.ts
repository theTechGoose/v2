/// <reference types="cypress" />

/**
 * RED (TDD) — 390px mobile layout of the two landing pages.
 *
 * P-17 "Root header is visually broken at 390px. 194px-tall header; 'Empezar'
 *       CTA wraps to its own row flush at x=0 (measured 104×47 @ 0,132)
 *       overlapping the hero boundary; 'Entrar' and the language pill
 *       misaligned (y:62 vs y:79)."
 * P-18 "/landing language toggle is two mashed 20px underlined links — reads
 *       'EspañolEnglish', far below the ~44px tap minimum."
 *
 * Grounding: landing.css @media(max-width:980px) sets .nav{flex-wrap:wrap} so
 * brand + toggle + Entrar + Empezar stack into ~3 rows (~194px). promo.css has
 * NO .pm-langtoggle rule at all — the two <a> are bare adjacent inline links
 * with zero gap.
 */

describe("P-17 / header at 390px", () => {
  beforeEach(() => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "es");
    cy.viewport(390, 844);
    cy.visit("/");
    // landing-scripts.js is deferred; "Empezar" proves applyLang("es") ran
    // and the header has its final layout.
    cy.contains(".nav a", "Empezar");
  });

  it("P-17 header is a compact single-row bar (< 120px tall)", () => {
    cy.get(".nav-wrap").then(($h) => {
      const r = $h[0].getBoundingClientRect();
      // Red today: the wrapping .nav stacks to ~194px.
      expect(r.height, `header height ${Math.round(r.height)}px`).to.be
        .lessThan(120);
    });
  });

  it("P-17 the Empezar CTA sits inside the header row — not flush-left on its own row bleeding into the hero", () => {
    cy.get(".nav-wrap").then(($h) => {
      const header = $h[0].getBoundingClientRect();
      cy.get(".nav a.btn-primary").then(($cta) => {
        const cta = $cta[0].getBoundingClientRect();
        cy.get("section.hero").then(($hero) => {
          const hero = $hero[0].getBoundingClientRect();
          // Red today: CTA measured 104×47 @ (0,132) — wrapped row, x=0.
          expect(cta.x, `CTA x=${Math.round(cta.x)} must be > 0`).to.be
            .greaterThan(0);
          expect(
            cta.bottom,
            `CTA bottom ${Math.round(cta.bottom)} inside header bottom ${
              Math.round(header.bottom)
            }`,
          ).to.be.at.most(header.bottom + 1);
          expect(
            cta.bottom,
            `CTA bottom ${Math.round(cta.bottom)} must not cross hero top ${
              Math.round(hero.top)
            }`,
          ).to.be.at.most(hero.top + 1);
        });
      });
    });
  });

  it("P-17 Entrar and the language pill are vertically aligned (|Δ centerY| ≤ 6px)", () => {
    cy.get(".nav a[href='/login']").then(($login) => {
      const a = $login[0].getBoundingClientRect();
      cy.get(".nav .lang-toggle").then(($pill) => {
        const b = $pill[0].getBoundingClientRect();
        const delta = Math.abs(
          (a.top + a.height / 2) - (b.top + b.height / 2),
        );
        // Red today: audit measured y:62 (Entrar) vs y:79 (pill).
        expect(
          delta,
          `centerY delta ${delta.toFixed(1)}px (Entrar ${Math.round(a.top)}–${
            Math.round(a.bottom)
          } vs pill ${Math.round(b.top)}–${Math.round(b.bottom)})`,
        ).to.be.at.most(6);
      });
    });
  });
});

describe("P-18 /landing language toggle at 390px", () => {
  beforeEach(() => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "es");
    cy.viewport(390, 844);
    cy.visit("/landing");
    cy.get(".pm-langtoggle a").should("have.length", 2);
  });

  it("P-18 the two language controls are visually separated (gap ≥ 8px)", () => {
    cy.get(".pm-langtoggle a").then(($links) => {
      const [a, b] = [...$links].map((el) => el.getBoundingClientRect());
      const hGap = Math.max(b.left - a.right, a.left - b.right);
      const vGap = Math.max(b.top - a.bottom, a.top - b.bottom);
      const gap = Math.max(hGap, vGap);
      // Red today: the two <a> are butted with zero whitespace → gap 0.
      expect(
        gap,
        `gap ${gap.toFixed(1)}px between "Español" and "English"`,
      ).to.be.at.least(8);
    });
  });

  it("P-18 each language control is a real tap target (≥ 44px in one dimension, ≥ 24px in the other)", () => {
    // The audit's complaint is the ~20px-tall bare text links. "Español" is
    // already wider than 44px at the inherited font, so a pure
    // 44-in-either-dimension check would pass today; the red is pinned on the
    // WCAG 2.5.8 24px floor for the SMALL dimension, with ≥ 44px still
    // required in the large one.
    cy.get(".pm-langtoggle a").each(($el) => {
      const r = $el[0].getBoundingClientRect();
      const big = Math.max(r.width, r.height);
      const small = Math.min(r.width, r.height);
      expect(
        big,
        `larger dim of "${$el.text()}" (${r.width.toFixed(0)}×${
          r.height.toFixed(0)
        })`,
      ).to.be.at.least(44);
      // Red today: bare inline links are ~20px tall.
      expect(
        small,
        `smaller dim of "${$el.text()}" (${r.width.toFixed(0)}×${
          r.height.toFixed(0)
        })`,
      ).to.be.at.least(24);
    });
  });

  it('P-18 the toggle never renders as the mashed text "EspañolEnglish"', () => {
    cy.get(".pm-langtoggle").then(($t) => {
      const el = $t[0] as HTMLElement;
      const rendered = (el.innerText || "").replace(/\s+/g, "");
      const [a, b] = Array.from(el.querySelectorAll("a")).map((x) =>
        x.getBoundingClientRect()
      );
      const touching = Math.max(
        b.left - a.right,
        a.left - b.right,
        b.top - a.bottom,
        a.top - b.bottom,
      ) < 2;
      // Red today: two butted inline anchors render literally "EspañolEnglish".
      expect(
        rendered === "EspañolEnglish" && touching,
        `toggle renders "${el.innerText}" with touching links`,
      ).to.eq(false);
    });
  });
});
